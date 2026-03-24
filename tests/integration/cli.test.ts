import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

describe("Capstan CLI", () => {
  it("validates a JSON graph fixture", async () => {
    const result = await runCapstanCli([
      "graph:check",
      "./tests/fixtures/graphs/basic-app-graph.json"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("App Graph is valid.");
  });

  it("validates an ESM graph fixture", async () => {
    const result = await runCapstanCli([
      "graph:check",
      "./tests/fixtures/graphs/basic-app-graph.mjs"
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("App Graph is valid.");
  });

  it("scaffolds a graph into a compiling application skeleton", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-scaffold-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);
    expect(scaffoldResult.stdout).toContain("Scaffolded");

    await expect(access(join(outputDir, "src/capabilities/list-tickets.ts"))).resolves.toBeUndefined();
    await expect(
      access(join(outputDir, "src/capabilities/generated/list-tickets.ts"))
    ).resolves.toBeUndefined();
    await expect(access(join(outputDir, "src/views/ticket-list.ts"))).resolves.toBeUndefined();
    await expect(
      access(join(outputDir, "src/views/generated/ticket-list.ts"))
    ).resolves.toBeUndefined();
    await expect(access(join(outputDir, "AGENTS.md"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "agent-surface.json"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "capstan.migrations.json"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "capstan.release-env.json"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "capstan.release.json"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "human-surface.html"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "src/agent-surface/index.ts"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "src/agent-surface/http.ts"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "src/agent-surface/mcp.ts"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "src/agent-surface/a2a.ts"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "src/agent-surface/transport.ts"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "src/release/index.ts"))).resolves.toBeUndefined();
    await expect(access(join(outputDir, "src/human-surface/index.ts"))).resolves.toBeUndefined();

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    const typecheckResult = await runTypeScriptCheck(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(buildResult.stderr).toBe("");
    expect(typecheckResult.exitCode).toBe(0);
    expect(typecheckResult.stderr).toBe("");

    const agentsGuide = await readFile(join(outputDir, "AGENTS.md"), "utf8");
    const agentSurfaceJson = await readFile(join(outputDir, "agent-surface.json"), "utf8");
    const releaseEnvironmentSnapshotJson = await readFile(
      join(outputDir, "capstan.release-env.json"),
      "utf8"
    );
    const releaseMigrationPlanJson = await readFile(
      join(outputDir, "capstan.migrations.json"),
      "utf8"
    );
    const releaseContractJson = await readFile(join(outputDir, "capstan.release.json"), "utf8");
    const agentSurfaceModule = await readFile(
      join(outputDir, "src/agent-surface/index.ts"),
      "utf8"
    );
    const agentTransportModule = await readFile(
      join(outputDir, "src/agent-surface/transport.ts"),
      "utf8"
    );
    const agentHttpModule = await readFile(
      join(outputDir, "src/agent-surface/http.ts"),
      "utf8"
    );
    const agentMcpModule = await readFile(
      join(outputDir, "src/agent-surface/mcp.ts"),
      "utf8"
    );
    const agentA2aModule = await readFile(
      join(outputDir, "src/agent-surface/a2a.ts"),
      "utf8"
    );
    const humanSurfaceHtml = await readFile(join(outputDir, "human-surface.html"), "utf8");
    const humanSurfaceModule = await readFile(
      join(outputDir, "src/human-surface/index.ts"),
      "utf8"
    );
    const releaseModule = await readFile(join(outputDir, "src/release/index.ts"), "utf8");
    expect(agentsGuide).toContain("# Capstan Agent Guide");
    expect(agentsGuide).toContain("## Official Starter Prompt");
    expect(agentsGuide).toContain("src/assertions/custom.ts");
    expect(agentsGuide).toContain("npx capstan verify . --json");
    expect(agentsGuide).toContain("upstream Capstan brief or App Graph");
    expect(agentSurfaceJson).toContain('"entrypoints"');
    expect(agentSurfaceJson).toContain('"transport"');
    expect(agentSurfaceJson).toContain('"http_rpc"');
    expect(agentSurfaceJson).toContain('"mcp"');
    expect(agentSurfaceJson).toContain('"a2a"');
    expect(agentSurfaceJson).toContain('"auth"');
    expect(agentSurfaceJson).toContain('"approval_required"');
    expect(agentSurfaceJson).toContain('"search"');
    expect(agentSurfaceModule).toContain("export const agentSurface");
    expect(agentSurfaceModule).toContain("renderAgentSurfaceManifest");
    expect(agentTransportModule).toContain("handleAgentSurfaceRequest");
    expect(agentTransportModule).toContain("createAgentSurfaceTransport");
    expect(agentTransportModule).toContain('operation: "startTask"');
    expect(agentHttpModule).toContain("handleAgentSurfaceHttpRequest");
    expect(agentHttpModule).toContain('path === "/rpc"');
    expect(agentMcpModule).toContain("listAgentSurfaceMcpTools");
    expect(agentA2aModule).toContain("createAgentSurfaceA2aAdapter");
    expect(agentA2aModule).toContain("sendAgentSurfaceA2aMessage");
    expect(agentMcpModule).toContain("createAgentSurfaceMcpAdapter");
    expect(releaseContractJson).toContain('"preview"');
    expect(releaseContractJson).toContain('"healthChecks"');
    expect(releaseContractJson).toContain('"inputs"');
    expect(releaseContractJson).toContain('"verify_pass"');
    expect(releaseEnvironmentSnapshotJson).toContain('"environments"');
    expect(releaseEnvironmentSnapshotJson).toContain('"NODE_ENV"');
    expect(releaseMigrationPlanJson).toContain('"status": "safe"');
    expect(releaseMigrationPlanJson).toContain('"generatedBy": "capstan"');
    expect(humanSurfaceHtml).toContain("Capstan Human Surface");
    expect(humanSurfaceHtml).toContain("Operator Console");
    expect(humanSurfaceHtml).toContain("Ticket List");
    expect(humanSurfaceHtml).toContain("Ticket Detail");
    expect(humanSurfaceHtml).toContain("Ticket Form");
    expect(humanSurfaceHtml).toContain("List Tickets");
    expect(humanSurfaceHtml).toContain("data-action-key=\"listTickets\"");
    expect(humanSurfaceHtml).toContain("data-route-mode=\"loading\"");
    expect(humanSurfaceHtml).toContain("data-route-table-body=\"ticketList\"");
    expect(humanSurfaceHtml).toContain("data-route-detail-value-route=\"ticketDetail\"");
    expect(humanSurfaceHtml).toContain("data-route-result-output=\"ticketForm\"");
    expect(humanSurfaceHtml).toContain("data-route-result-state=\"idle\"");
    expect(humanSurfaceHtml).toContain("mountHumanSurfaceBrowser(document)");
    expect(humanSurfaceModule).toContain(
      'import { execute, listAttentionItems, listAttentionQueues } from "../control-plane/index.js";'
    );
    expect(humanSurfaceModule).toContain("export function mountHumanSurfaceBrowser");
    expect(humanSurfaceModule).toContain("resourceRecords");
    expect(humanSurfaceModule).toContain("renderRouteProjection");
    expect(humanSurfaceModule).toContain("data-console-attention-output");
    expect(humanSurfaceModule).toContain("data-console-attention-inbox");
    expect(humanSurfaceModule).toContain("data-console-attention-preset-inbox");
    expect(humanSurfaceModule).toContain("data-console-attention-preset-queue");
    expect(humanSurfaceModule).toContain("data-console-supervision-refresh");
    expect(humanSurfaceModule).toContain("data-console-supervision-queue-status");
    expect(humanSurfaceModule).toContain("data-console-supervision-history-resume");
    expect(humanSurfaceModule).toContain("data-console-supervision-clear-history");
    expect(humanSurfaceModule).toContain("renderAttentionProjection");
    expect(humanSurfaceModule).toContain("data-route-attention-output");
    expect(humanSurfaceModule).toContain("data-route-attention-handoff");
    expect(humanSurfaceModule).toContain("data-route-attention-handoff-open");
    expect(humanSurfaceModule).toContain("supervisionWorkspace");
    expect(humanSurfaceModule).toContain("supervisionWorkspaceHistory");
    expect(humanSurfaceModule).toContain("supervisionWorkspaceSlots");
    expect(humanSurfaceModule).toContain("supervisionWorkspaceSlotSummaries");
    expect(humanSurfaceModule).toContain("seenAttentionIds");
    expect(humanSurfaceModule).toContain("newOpenCount");
    expect(humanSurfaceModule).toContain("autoSaveAttentionPresetToSlot");
    expect(humanSurfaceModule).toContain("refreshSupervisionWorkspaceSlotSummaries");
    expect(humanSurfaceModule).toContain("supervisionWorkspaceStorageKey");
    expect(humanSurfaceModule).toContain("restoreSupervisionWorkspaceState");
    expect(humanSurfaceModule).toContain("persistSupervisionWorkspaceState");
    expect(humanSurfaceModule).toContain("data-console-supervision-slot-open");
    expect(humanSurfaceModule).toContain("data-console-supervision-slot-summary-open");
    expect(humanSurfaceModule).toContain("data-console-supervision-slot-summary-queue");
    expect(humanSurfaceModule).toContain("data-console-supervision-slot-save");
    expect(humanSurfaceModule).toContain("data-console-supervision-slot-clear");
    expect(humanSurfaceModule).toContain("version: 4");
    expect(humanSurfaceModule).toContain("workspaceSlot");
    expect(humanSurfaceModule).toContain("activeAttentionPreset");
    expect(releaseModule).toContain("export const releaseContract");
    expect(releaseModule).toContain("renderReleaseContract");
  }, 15000);

  it("regenerates framework-owned files while preserving user-owned files", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-regenerate-"));
    tempDirs.push(outputDir);

    const initialResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(initialResult.exitCode).toBe(0);

    const customHandlerFile = join(outputDir, "src/capabilities/list-tickets.ts");
    await writeFile(
      customHandlerFile,
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { listTicketsCapability } from "./generated/list-tickets.js";',
        "",
        "export async function listTickets(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: listTicketsCapability.key,",
        '    status: "completed",',
        "    input,",
        '    output: { source: "custom-handler" }',
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const userOwnedFile = join(outputDir, "src/custom/user-note.ts");
    await mkdir(dirname(userOwnedFile), { recursive: true });
    await writeFile(userOwnedFile, 'export const userNote = "keep me";\n', "utf8");

    const replacementGraphPath = join(outputDir, "replacement-graph.json");
    await writeFile(
      replacementGraphPath,
      `${JSON.stringify(
        {
          version: 1,
          domain: {
            key: "operations",
            title: "Operations Console"
          },
          resources: [
            {
              key: "ticket",
              title: "Ticket",
              fields: {
                title: {
                  type: "string",
                  required: true
                }
              }
            }
          ],
          capabilities: [
            {
              key: "archiveTicket",
              title: "Archive Ticket",
              mode: "write",
              resources: ["ticket"]
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const regenerateResult = await runCapstanCli(
      ["graph:scaffold", replacementGraphPath, outputDir, "--force"],
      {
        cwd: outputDir
      }
    );

    expect(regenerateResult.exitCode).toBe(0);

    await expect(
      access(join(outputDir, "src/capabilities/generated/archive-ticket.ts"))
    ).resolves.toBeUndefined();
    await expect(access(join(outputDir, "src/capabilities/archive-ticket.ts"))).resolves.toBeUndefined();
    await expect(
      access(join(outputDir, "src/capabilities/generated/list-tickets.ts"))
    ).resolves.toBeUndefined();
    await expect(access(join(outputDir, "src/views/ticket-list.ts"))).resolves.toBeUndefined();

    const preservedUserFile = await readFile(userOwnedFile, "utf8");
    expect(preservedUserFile).toContain("keep me");

    const preservedCustomHandler = await readFile(customHandlerFile, "utf8");
    expect(preservedCustomHandler).toContain("custom-handler");

    const manifest = JSON.parse(
      await readFile(join(outputDir, ".capstan/generated-files.json"), "utf8")
    ) as {
      appName: string;
      files: string[];
    };

    expect(manifest.appName).toBe("operations-app");
    expect(manifest.files).toContain("src/capabilities/generated/archive-ticket.ts");
    expect(manifest.files).toContain("agent-surface.json");
    expect(manifest.files).toContain("capstan.migrations.json");
    expect(manifest.files).toContain("capstan.release-env.json");
    expect(manifest.files).toContain("capstan.release.json");
    expect(manifest.files).toContain("human-surface.html");
    expect(manifest.files).toContain("src/agent-surface/index.ts");
    expect(manifest.files).toContain("src/agent-surface/http.ts");
    expect(manifest.files).toContain("src/agent-surface/mcp.ts");
    expect(manifest.files).toContain("src/agent-surface/a2a.ts");
    expect(manifest.files).toContain("src/agent-surface/transport.ts");
    expect(manifest.files).toContain("src/release/index.ts");
    expect(manifest.files).toContain("src/human-surface/index.ts");
    expect(manifest.files).toContain("src/views/index.ts");
    expect(manifest.files).not.toContain("src/capabilities/archive-ticket.ts");
    expect(manifest.files).not.toContain("src/capabilities/list-tickets.ts");
    expect(manifest.files).not.toContain("src/views/ticket-list.ts");
    expect(manifest.files).not.toContain("src/capabilities/generated/list-tickets.ts");
    expect(manifest.files).not.toContain("src/views/generated/ticket-list.ts");

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });
    const typecheckResult = await runTypeScriptCheck(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(typecheckResult.exitCode).toBe(0);
  }, 15000);

  it("keeps repeated scaffold runs deterministic for the same graph", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-stable-"));
    tempDirs.push(outputDir);

    const firstRun = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);
    expect(firstRun.exitCode).toBe(0);

    const firstManifest = JSON.parse(
      await readFile(join(outputDir, ".capstan/generated-files.json"), "utf8")
    ) as {
      files: string[];
      graphHash: string;
    };
    const firstOutput = await Promise.all(
      firstManifest.files.map(async (file) => [file, await readFile(join(outputDir, file), "utf8")])
    );

    const secondRun = await runCapstanCli(
      ["graph:scaffold", "./tests/fixtures/graphs/basic-app-graph.json", outputDir, "--force"],
      {
        cwd: repoRoot
      }
    );
    expect(secondRun.exitCode).toBe(0);

    const secondManifest = JSON.parse(
      await readFile(join(outputDir, ".capstan/generated-files.json"), "utf8")
    ) as {
      files: string[];
      graphHash: string;
    };
    const secondOutput = await Promise.all(
      secondManifest.files.map(async (file) => [
        file,
        await readFile(join(outputDir, file), "utf8")
      ])
    );

    expect(secondManifest).toEqual(firstManifest);
    expect(secondOutput).toEqual(firstOutput);
  });

  it("prints graph metadata, validation, and normalized output", async () => {
    const result = await runCapstanCli([
      "graph:inspect",
      "./tests/fixtures/graphs/basic-app-graph.json"
    ]);

    expect(result.exitCode).toBe(0);

    const inspection = JSON.parse(result.stdout) as {
      metadata: { sourceVersion: number; normalizedVersion: number; upgraded: boolean };
      summary: {
        version: number;
        valid: boolean;
        counts: { resources: number; capabilities: number; views: number };
        keys: { resources: string[] };
      };
      normalizedGraph: { version: number };
      validation: { ok: boolean };
    };

    expect(inspection.metadata).toMatchObject({
      sourceVersion: 1,
      normalizedVersion: 1,
      upgraded: false
    });
    expect(inspection.summary.version).toBe(1);
    expect(inspection.summary.valid).toBe(true);
    expect(inspection.summary.counts).toMatchObject({
      resources: 1,
      capabilities: 1,
      views: 1
    });
    expect(inspection.summary.keys.resources).toEqual(["ticket"]);
    expect(inspection.normalizedGraph.version).toBe(1);
    expect(inspection.validation.ok).toBe(true);
  });

  it("prints upgraded introspection for legacy fixtures and scaffolds normalized output", async () => {
    const inspectResult = await runCapstanCli([
      "graph:inspect",
      "./tests/fixtures/graphs/legacy-basic-app-graph.json"
    ]);

    expect(inspectResult.exitCode).toBe(0);

    const inspection = JSON.parse(inspectResult.stdout) as {
      metadata: { sourceVersion: number; normalizedVersion: number; upgraded: boolean };
      normalizedGraph: {
        version: number;
        domain: { key: string; title: string; description: string };
      };
      validation: { ok: boolean };
    };

    expect(inspection.metadata).toMatchObject({
      sourceVersion: 0,
      normalizedVersion: 1,
      upgraded: true
    });
    expect(inspection.normalizedGraph.version).toBe(1);
    expect(inspection.normalizedGraph.domain).toEqual({
      key: "operations",
      title: "Operations Console",
      description: "A legacy graph fixture without an explicit version."
    });
    expect(inspection.validation.ok).toBe(true);

    const outputDir = await mkdtemp(join(tmpdir(), "capstan-legacy-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/legacy-basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    const generatedGraph = JSON.parse(
      await readFile(join(outputDir, "capstan.app.json"), "utf8")
    ) as {
      version: number;
      domain: { key: string; title: string; description: string };
    };
    const metadata = JSON.parse(
      await readFile(join(outputDir, ".capstan/graph-metadata.json"), "utf8")
    ) as {
      sourceVersion: number;
      normalizedVersion: number;
      upgraded: boolean;
    };

    expect(generatedGraph.version).toBe(1);
    expect(generatedGraph.domain).toEqual({
      key: "operations",
      title: "Operations Console",
      description: "A legacy graph fixture without an explicit version."
    });
    expect(metadata).toMatchObject({
      sourceVersion: 0,
      normalizedVersion: 1,
      upgraded: true
    });
  });

  it("prints a machine-readable diff between two graphs", async () => {
    const result = await runCapstanCli([
      "graph:diff",
      "./tests/fixtures/graphs/basic-app-graph.json",
      "./tests/fixtures/graphs/expanded-app-graph.json"
    ]);

    expect(result.exitCode).toBe(0);

    const diff = JSON.parse(result.stdout) as {
      domainChanged: boolean;
      resources: { added: string[]; changed: string[] };
      capabilities: { added: string[]; changed: string[] };
    };

    expect(diff.domainChanged).toBe(true);
    expect(diff.resources.added).toEqual(["customer"]);
    expect(diff.resources.changed).toEqual(["ticket"]);
    expect(diff.capabilities.added).toEqual(["getCustomer"]);
    expect(diff.capabilities.changed).toEqual(["listTickets"]);
  });
});

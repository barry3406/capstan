import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { repoRoot } from "../helpers/paths.ts";
import { runCapstanCli, runTypeScriptBuild } from "../helpers/run-cli.ts";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("generated human surface runtime", () => {
  it("projects executed capability results back into list/detail/form routes", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-human-surface-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/basic-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/list-tickets.ts"),
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
        "    output: {",
        "      records: [",
        "        {",
        '          status: String(input.status ?? "Open"),',
        '          title: String(input.title ?? "Escalated parcel")',
        "        }",
        "      ]",
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
    expect(buildResult.stderr).toBe("");

    const html = await readFile(join(outputDir, "human-surface.html"), "utf8");
    const dom = new JSDOM(html, {
      url: "http://capstan.local/#ticketForm"
    });

    const moduleUrl = pathToFileURL(join(outputDir, "dist/human-surface/index.js")).href;
    const { mountHumanSurfaceBrowser } = (await import(moduleUrl)) as {
      mountHumanSurfaceBrowser: (root: Document) => {
        activeRouteKey: string;
        modes: Record<string, string>;
      };
    };

    const runtime = mountHumanSurfaceBrowser(dom.window.document);

    expect(runtime.activeRouteKey).toBe("ticketForm");

    const statusInput = dom.window.document.querySelector<HTMLInputElement>(
      '[data-route-input-key="ticketForm"][data-field-key="status"]'
    );
    const titleInput = dom.window.document.querySelector<HTMLInputElement>(
      '[data-route-input-key="ticketForm"][data-field-key="title"]'
    );
    const formAction = dom.window.document.querySelector<HTMLButtonElement>(
      '[data-route-action="ticketForm"][data-action-key="listTickets"]'
    );

    expect(statusInput).not.toBeNull();
    expect(titleInput).not.toBeNull();
    expect(formAction).not.toBeNull();

    statusInput!.value = "Open";
    titleInput!.value = "Delayed parcel";
    formAction!.click();

    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(
      dom.window.document.querySelector('[data-route-result-status="ticketForm"]')?.textContent
    ).toBe("completed");
    expect(
      dom.window.document.querySelector('[data-route-result-output="ticketForm"]')?.textContent
    ).toContain("Delayed parcel");
    expect(dom.window.document.querySelector("[data-console-output]")?.textContent).toContain(
      "capability.execute"
    );

    const ticketListNav = dom.window.document.querySelector<HTMLElement>(
      '[data-route-nav="ticketList"]'
    );
    ticketListNav?.click();

    expect(dom.window.location.hash).toBe("#ticketList");
    expect(
      dom.window.document.querySelector('[data-route-table-body="ticketList"]')?.textContent
    ).toContain("Delayed parcel");
    expect(
      dom.window.document.querySelector('[data-route-table-body="ticketList"]')?.textContent
    ).toContain("Open");

    const ticketDetailNav = dom.window.document.querySelector<HTMLElement>(
      '[data-route-nav="ticketDetail"]'
    );
    ticketDetailNav?.click();

    expect(dom.window.location.hash).toBe("#ticketDetail");
    expect(
      dom.window.document.querySelector(
        '[data-route-detail-value-route="ticketDetail"][data-field-key="title"]'
      )?.textContent
    ).toBe("Delayed parcel");
    expect(
      dom.window.document.querySelector(
        '[data-route-detail-value-route="ticketDetail"][data-field-key="status"]'
      )?.textContent
    ).toBe("Open");
  }, 15_000);

  it("navigates related-record links into relation-scoped routes", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "capstan-human-related-runtime-"));
    tempDirs.push(tempRoot);

    const graphPath = join(tempRoot, "relation-runtime-app-graph.json");
    const outputDir = join(tempRoot, "generated-app");

    await writeFile(
      graphPath,
      `${JSON.stringify(
        {
          version: 1,
          domain: {
            key: "crm",
            title: "CRM Workspace"
          },
          resources: [
            {
              key: "account",
              title: "Account",
              fields: {
                name: {
                  type: "string",
                  required: true
                }
              },
              relations: {
                primaryContact: {
                  resource: "contact",
                  kind: "one",
                  description: "Primary contact for the account."
                }
              }
            },
            {
              key: "contact",
              title: "Contact",
              fields: {
                fullName: {
                  type: "string",
                  required: true
                }
              }
            }
          ],
          capabilities: [
            {
              key: "listAccounts",
              title: "List Accounts",
              mode: "read",
              resources: ["account"]
            },
            {
              key: "reviewAccount",
              title: "Review Account",
              mode: "external",
              resources: ["account"]
            },
            {
              key: "listContacts",
              title: "List Contacts",
              mode: "read",
              resources: ["contact"]
            },
            {
              key: "reviewContact",
              title: "Review Contact",
              mode: "external",
              resources: ["contact"],
              output: {
                fullName: {
                  type: "string",
                  required: true
                },
                relationshipState: {
                  type: "string"
                }
              }
            }
          ],
          views: []
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const scaffoldResult = await runCapstanCli(["graph:scaffold", graphPath, outputDir]);

    expect(scaffoldResult.exitCode).toBe(0);

    const buildResult = await runTypeScriptBuild(join(outputDir, "tsconfig.json"), {
      cwd: repoRoot
    });

    expect(buildResult.exitCode).toBe(0);
    expect(buildResult.stderr).toBe("");

    const html = await readFile(join(outputDir, "human-surface.html"), "utf8");
    const dom = new JSDOM(html, {
      url: "http://capstan.local/#accountDetail"
    });

    const moduleUrl = pathToFileURL(join(outputDir, "dist/human-surface/index.js")).href;
    const { mountHumanSurfaceBrowser } = (await import(moduleUrl)) as {
      mountHumanSurfaceBrowser: (root: Document) => {
        activeRouteKey: string;
      };
    };

    const runtime = mountHumanSurfaceBrowser(dom.window.document);

    expect(runtime.activeRouteKey).toBe("accountDetail");

    dom.window.document
      .querySelector<HTMLElement>(
        '[data-related-path="/resources/account/relations/primary-contact/detail"]'
      )
      ?.click();

    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(dom.window.location.hash).toBe("#accountPrimaryContactRelationDetail");
    expect(
      dom.window.document.querySelector('[data-route-key="accountPrimaryContactRelationDetail"]')
        ?.hidden
    ).toBe(false);
    expect(dom.window.document.querySelector("[data-console-route]")?.textContent).toBe(
      "Account Primary Contact Detail"
    );
    expect(dom.window.document.querySelector("[data-console-output]")?.textContent).toContain(
      "route.related"
    );
    expect(
      dom.window.document.querySelector(
        '[data-route-detail-value-route="accountPrimaryContactRelationDetail"][data-field-key="fullName"]'
      )?.textContent
    ).toContain("Full Name sample");
  }, 15_000);

  it("surfaces live attention queue lanes for durable route actions", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-human-attention-runtime-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/agent-surface-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/generate-digest.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { generateDigestCapability } from "./generated/generate-digest.js";',
        "",
        "export async function generateDigest(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        '  if (input.mode === "needs_approval" && input.approved !== true) {',
        "    return {",
        "      capability: generateDigestCapability.key,",
        '      status: "approval_required",',
        "      input,",
        '      note: "Manager approval required before digest generation."',
        "    };",
        "  }",
        "",
        '  if (input.mode === "needs_input" && typeof input.ticketId !== "string") {',
        "    return {",
        "      capability: generateDigestCapability.key,",
        '      status: "input_required",',
        "      input,",
        '      note: "Ticket selection is incomplete."',
        "    };",
        "  }",
        "",
        '  if (input.mode === "blocked" && input.unblocked !== true) {',
        "    return {",
        "      capability: generateDigestCapability.key,",
        '      status: "blocked",',
        "      input,",
        '      note: "Execution is blocked by policy."',
        "    };",
        "  }",
        "",
        "  return {",
        "    capability: generateDigestCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        '      reportId: "digest-001",',
        '      ticketId: String(input.ticketId ?? "T-100")',
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
    expect(buildResult.stderr).toBe("");
    const runtimeCheckPath = join(outputDir, "attention-runtime-check.mjs");
    await writeFile(
      runtimeCheckPath,
      [
        'import { readFile } from "node:fs/promises";',
        'import { pathToFileURL } from "node:url";',
        "",
        `const jsdomModuleUrl = ${JSON.stringify(pathToFileURL(join(repoRoot, "node_modules/jsdom/lib/api.js")).href)};`,
        'const { JSDOM } = await import(jsdomModuleUrl);',
        'const outputDir = process.argv[2];',
        'const controlPlaneModule = await import(pathToFileURL(`${outputDir}/dist/control-plane/index.js`).href);',
        'await controlPlaneModule.startTaskAction("ticketList", "generateDigest", { ticketId: "T-101", mode: "needs_approval" });',
        'await controlPlaneModule.startTaskAction("ticketList", "generateDigest", { mode: "needs_input" });',
        'await controlPlaneModule.startTaskAction("ticketList", "generateDigest", { ticketId: "T-102", mode: "blocked" });',
        'const html = await readFile(`${outputDir}/human-surface.html`, "utf8");',
        'const dom = new JSDOM(html, { url: "http://capstan.local/#ticketList" });',
        'const humanSurfaceModule = await import(pathToFileURL(`${outputDir}/dist/human-surface/index.js`).href);',
        'humanSurfaceModule.mountHumanSurfaceBrowser(dom.window.document);',
        'dom.window.document.querySelector(\'[data-route-nav="workspaceHome"]\')?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'dom.window.document.querySelector(\'[data-console-attention-inbox="workflowAttentionInbox"]\')?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const globalConsoleAttentionOutput = dom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'dom.window.document.querySelector(\'[data-console-attention-preset-inbox="task:generateDigestTask"]\')?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const taskPresetAttentionStatus = dom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const taskPresetAttentionOutput = dom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'dom.window.document.querySelector(\'[data-console-attention-preset-queue="resource:ticket"][data-console-attention-preset-status="blocked"]\')?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const resourcePresetAttentionStatus = dom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const resourcePresetAttentionOutput = dom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'dom.window.document.querySelector(\'[data-console-attention-preset-inbox="route:ticketList"]\')?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const routePresetAttentionStatus = dom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const routePresetAttentionOutput = dom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'const routePresetActiveRoute = dom.window.document.querySelector("[data-console-route]")?.textContent ?? "";',
        'const supervisionWorkspaceStatus = dom.window.document.querySelector("[data-console-supervision-status]")?.textContent ?? "";',
        'const supervisionWorkspaceTrail = dom.window.document.querySelector("[data-console-supervision-trail]")?.textContent ?? "";',
        'const supervisionWorkspaceCopy = dom.window.document.querySelector("[data-console-supervision-copy]")?.textContent ?? "";',
        'const supervisionWorkspaceTotal = dom.window.document.querySelector("[data-console-supervision-total]")?.textContent ?? "";',
        'const supervisionWorkspaceQueueButtons = Array.from(dom.window.document.querySelectorAll("[data-console-supervision-queue-status]")).map((button) => button.textContent ?? "");',
        'const supervisionWorkspaceHistoryCount = dom.window.document.querySelector("[data-console-supervision-history-count]")?.textContent ?? "";',
        'const supervisionWorkspaceHistoryResumeButtons = Array.from(dom.window.document.querySelectorAll("[data-console-supervision-history-resume]")).map((button) => button.textContent ?? "");',
        'const supervisionWorkspaceHistoryText = dom.window.document.querySelector("[data-console-supervision-history]")?.textContent ?? "";',
        'const routeAttentionHandoff = dom.window.document.querySelector(\'[data-route-attention-handoff="ticketList"]\')?.textContent ?? "";',
        'const routeAttentionHandoffControls = Array.from(dom.window.document.querySelectorAll(\'[data-route-attention-handoff-open="ticketList"]\')).map((button) => button.textContent ?? "");',
        'const routeAttentionHandoffCopy = dom.window.document.querySelector(\'[data-route-attention-handoff-copy="ticketList"]\')?.textContent ?? "";',
        'dom.window.document.querySelector(\'[data-console-attention-inbox="workflowAttentionInbox"]\')?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const supervisionWorkspaceTrailAfterGlobalInbox = dom.window.document.querySelector("[data-console-supervision-trail]")?.textContent ?? "";',
        'dom.window.document.querySelector("[data-console-supervision-refresh]")?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const supervisionWorkspaceRefreshStatus = dom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const supervisionWorkspaceRefreshOutput = dom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'dom.window.document.querySelector(\'[data-console-supervision-queue-status="blocked"]\')?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const supervisionWorkspaceBlockedStatus = dom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const supervisionWorkspaceBlockedOutput = dom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'dom.window.document.querySelector("[data-console-supervision-refresh]")?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const supervisionWorkspaceRefreshBlockedStatus = dom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const supervisionWorkspaceRefreshBlockedOutput = dom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'dom.window.document.querySelector("[data-console-supervision-inbox]")?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const supervisionWorkspaceInboxStatus = dom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const supervisionWorkspaceInboxOutput = dom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'dom.window.document.querySelector(\'[data-console-supervision-history-resume="1"]\')?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const supervisionWorkspaceHistoryResumeStatus = dom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const supervisionWorkspaceHistoryResumeOutput = dom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'dom.window.document.querySelector("[data-console-supervision-clear-active]")?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const supervisionWorkspaceAfterClearActiveTrail = dom.window.document.querySelector("[data-console-supervision-trail]")?.textContent ?? "";',
        'const supervisionWorkspaceAfterClearActiveCount = dom.window.document.querySelector("[data-console-supervision-history-count]")?.textContent ?? "";',
        'dom.window.document.querySelector("[data-console-supervision-clear-history]")?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const supervisionWorkspaceAfterClearHistoryTrail = dom.window.document.querySelector("[data-console-supervision-trail]")?.textContent ?? "";',
        'const supervisionWorkspaceAfterClearHistoryText = dom.window.document.querySelector("[data-console-supervision-history]")?.textContent ?? "";',
        'const supervisionWorkspaceAfterClearHistoryCount = dom.window.document.querySelector("[data-console-supervision-history-count]")?.textContent ?? "";',
        'const supervisionWorkspaceRefreshDisabledAfterClear = dom.window.document.querySelector("[data-console-supervision-refresh]")?.hasAttribute("disabled") ?? false;',
        'dom.window.document.querySelector(\'[data-attention-route-key="ticketList"][data-attention-action-key="generateDigest"][data-attention-queue-status="approval_required"]\')?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'dom.window.document.querySelector(\'[data-route-attention-handoff-open="ticketList"][data-route-attention-handoff-step="1"]\')?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const resourceHandoffReturnStatus = dom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const resourceHandoffReturnOutput = dom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'dom.window.document.querySelector(\'[data-route-attention-handoff-open="ticketList"][data-route-attention-handoff-step="0"]\')?.click();',
        'await new Promise((resolve) => dom.window.setTimeout(resolve, 0));',
        'const taskHandoffReturnStatus = dom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const taskHandoffReturnOutput = dom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'const handoffReturnActiveRoute = dom.window.document.querySelector("[data-console-route]")?.textContent ?? "";',
        'process.stdout.write(JSON.stringify({',
        '  attentionStatus: dom.window.document.querySelector(\'[data-route-attention-status="ticketList"]\')?.textContent ?? "",',
        '  attentionOutput: dom.window.document.querySelector(\'[data-route-attention-output="ticketList"]\')?.textContent ?? "",',
        '  consoleAttentionStatus: dom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "",',
        '  consoleAttentionOutput: dom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "",',
        '  globalConsoleAttentionOutput,',
        '  taskPresetAttentionStatus,',
        '  taskPresetAttentionOutput,',
        '  routePresetAttentionStatus,',
        '  routePresetAttentionOutput,',
        '  routePresetActiveRoute,',
        '  supervisionWorkspaceStatus,',
        '  supervisionWorkspaceTrail,',
        '  supervisionWorkspaceCopy,',
        '  supervisionWorkspaceTotal,',
        '  supervisionWorkspaceQueueButtons,',
        '  supervisionWorkspaceHistoryCount,',
        '  supervisionWorkspaceHistoryResumeButtons,',
        '  supervisionWorkspaceHistoryText,',
        '  routeAttentionHandoff,',
        '  routeAttentionHandoffControls,',
        '  routeAttentionHandoffCopy,',
        '  supervisionWorkspaceTrailAfterGlobalInbox,',
        '  supervisionWorkspaceRefreshStatus,',
        '  supervisionWorkspaceRefreshOutput,',
        '  supervisionWorkspaceBlockedStatus,',
        '  supervisionWorkspaceBlockedOutput,',
        '  supervisionWorkspaceRefreshBlockedStatus,',
        '  supervisionWorkspaceRefreshBlockedOutput,',
        '  supervisionWorkspaceInboxStatus,',
        '  supervisionWorkspaceInboxOutput,',
        '  supervisionWorkspaceHistoryResumeStatus,',
        '  supervisionWorkspaceHistoryResumeOutput,',
        '  supervisionWorkspaceAfterClearActiveTrail,',
        '  supervisionWorkspaceAfterClearActiveCount,',
        '  supervisionWorkspaceAfterClearHistoryTrail,',
        '  supervisionWorkspaceAfterClearHistoryText,',
        '  supervisionWorkspaceAfterClearHistoryCount,',
        '  supervisionWorkspaceRefreshDisabledAfterClear,',
        '  resourcePresetAttentionStatus,',
        '  resourcePresetAttentionOutput,',
        '  resourceHandoffReturnStatus,',
        '  resourceHandoffReturnOutput,',
        '  taskHandoffReturnStatus,',
        '  taskHandoffReturnOutput,',
        '  handoffReturnActiveRoute,',
        '  consoleOutput: dom.window.document.querySelector("[data-console-output]")?.textContent ?? ""',
        '}, null, 2));'
      ].join("\n"),
      "utf8"
    );

    const { stdout, stderr } = await execFileAsync(process.execPath, [runtimeCheckPath, outputDir], {
      cwd: repoRoot
    });
    const runtimePayload = JSON.parse(stdout) as {
      attentionStatus: string;
      attentionOutput: string;
      consoleAttentionStatus: string;
      consoleAttentionOutput: string;
      globalConsoleAttentionOutput: string;
      taskPresetAttentionStatus: string;
      taskPresetAttentionOutput: string;
      routePresetAttentionStatus: string;
      routePresetAttentionOutput: string;
      routePresetActiveRoute: string;
      supervisionWorkspaceStatus: string;
      supervisionWorkspaceTrail: string;
      supervisionWorkspaceCopy: string;
      supervisionWorkspaceTotal: string;
      supervisionWorkspaceQueueButtons: string[];
      supervisionWorkspaceHistoryCount: string;
      supervisionWorkspaceHistoryResumeButtons: string[];
      supervisionWorkspaceHistoryText: string;
      routeAttentionHandoff: string;
      routeAttentionHandoffControls: string[];
      routeAttentionHandoffCopy: string;
      supervisionWorkspaceTrailAfterGlobalInbox: string;
      supervisionWorkspaceRefreshStatus: string;
      supervisionWorkspaceRefreshOutput: string;
      supervisionWorkspaceBlockedStatus: string;
      supervisionWorkspaceBlockedOutput: string;
      supervisionWorkspaceRefreshBlockedStatus: string;
      supervisionWorkspaceRefreshBlockedOutput: string;
      supervisionWorkspaceInboxStatus: string;
      supervisionWorkspaceInboxOutput: string;
      supervisionWorkspaceHistoryResumeStatus: string;
      supervisionWorkspaceHistoryResumeOutput: string;
      supervisionWorkspaceAfterClearActiveTrail: string;
      supervisionWorkspaceAfterClearActiveCount: string;
      supervisionWorkspaceAfterClearHistoryTrail: string;
      supervisionWorkspaceAfterClearHistoryText: string;
      supervisionWorkspaceAfterClearHistoryCount: string;
      supervisionWorkspaceRefreshDisabledAfterClear: boolean;
      resourcePresetAttentionStatus: string;
      resourcePresetAttentionOutput: string;
      resourceHandoffReturnStatus: string;
      resourceHandoffReturnOutput: string;
      taskHandoffReturnStatus: string;
      taskHandoffReturnOutput: string;
      handoffReturnActiveRoute: string;
      consoleOutput: string;
    };

    expect(stderr).toBe("");
    expect(runtimePayload.attentionStatus).toBe("approval_required");
    expect(runtimePayload.consoleAttentionStatus).toBe("approval_required");
    expect(runtimePayload.globalConsoleAttentionOutput).toContain("console.attention.inbox");
    expect(runtimePayload.taskPresetAttentionStatus).toBe("approval_required");
    expect(runtimePayload.taskPresetAttentionOutput).toContain("console.attention.preset.inbox");
    expect(runtimePayload.taskPresetAttentionOutput).toContain('"scope": "task"');
    expect(runtimePayload.taskPresetAttentionOutput).toContain('"taskKey": "generateDigestTask"');
    expect(runtimePayload.resourcePresetAttentionStatus).toBe("blocked");
    expect(runtimePayload.resourcePresetAttentionOutput).toContain("console.attention.preset.queue");
    expect(runtimePayload.resourcePresetAttentionOutput).toContain('"scope": "resource"');
    expect(runtimePayload.resourcePresetAttentionOutput).toContain('"resourceKey": "ticket"');
    expect(runtimePayload.routePresetAttentionStatus).toBe("approval_required");
    expect(runtimePayload.routePresetAttentionOutput).toContain("console.attention.preset.inbox");
    expect(runtimePayload.routePresetAttentionOutput).toContain('"scope": "route"');
    expect(runtimePayload.routePresetAttentionOutput).toContain('"routeKey": "ticketList"');
    expect(runtimePayload.routePresetActiveRoute).toBe("Ticket Queue");
    expect(runtimePayload.supervisionWorkspaceStatus).toBe("approval_required");
    expect(runtimePayload.supervisionWorkspaceTrail).toContain("Pinned Workspace");
    expect(runtimePayload.supervisionWorkspaceTrail).toContain("Task Attention");
    expect(runtimePayload.supervisionWorkspaceTrail).toContain("Resource Attention");
    expect(runtimePayload.supervisionWorkspaceTrail).toContain("Route Attention");
    expect(runtimePayload.supervisionWorkspaceCopy).toContain(
      'Pinned from task attention preset "Generate Ticket Digest"'
    );
    expect(runtimePayload.supervisionWorkspaceCopy).toContain(
      'into route attention preset "Ticket Queue"'
    );
    expect(runtimePayload.supervisionWorkspaceTotal).toBe("3 open");
    expect(runtimePayload.supervisionWorkspaceHistoryCount).toBe("3 saved");
    expect(runtimePayload.supervisionWorkspaceHistoryResumeButtons).toEqual([
      "Resume Active Workspace",
      "Resume Workspace",
      "Resume Workspace"
    ]);
    expect(runtimePayload.supervisionWorkspaceHistoryText).toContain("Saved Workspace");
    expect(runtimePayload.supervisionWorkspaceHistoryText).toContain("Active Workspace");
    expect(runtimePayload.supervisionWorkspaceQueueButtons).toContain(
      "Open Approval Required Queue · 1 open"
    );
    expect(runtimePayload.supervisionWorkspaceQueueButtons).toContain(
      "Open Input Required Queue · 1 open"
    );
    expect(runtimePayload.supervisionWorkspaceQueueButtons).toContain(
      "Open Blocked Queue · 1 open"
    );
    expect(runtimePayload.routeAttentionHandoff).toContain("Console Handoff");
    expect(runtimePayload.routeAttentionHandoff).toContain("Task Attention");
    expect(runtimePayload.routeAttentionHandoff).toContain("Generate Ticket Digest");
    expect(runtimePayload.routeAttentionHandoff).toContain("Resource Attention");
    expect(runtimePayload.routeAttentionHandoff).toContain("Ticket");
    expect(runtimePayload.routeAttentionHandoff).toContain("blocked");
    expect(runtimePayload.routeAttentionHandoff).toContain("Route Attention");
    expect(runtimePayload.routeAttentionHandoff).toContain("Ticket Queue");
    expect(runtimePayload.routeAttentionHandoffControls).toEqual([
      "Open Generate Ticket Digest Inbox",
      "Open Ticket blocked Queue",
      "Open Ticket Queue Inbox"
    ]);
    expect(runtimePayload.routeAttentionHandoffCopy).toContain(
      'Handoff from task attention preset "Generate Ticket Digest"'
    );
    expect(runtimePayload.routeAttentionHandoffCopy).toContain(
      'through resource attention preset "Ticket" via the blocked queue'
    );
    expect(runtimePayload.routeAttentionHandoffCopy).toContain(
      'into route attention preset "Ticket Queue"'
    );
    expect(runtimePayload.supervisionWorkspaceTrailAfterGlobalInbox).toContain(
      "Pinned Workspace"
    );
    expect(runtimePayload.supervisionWorkspaceRefreshStatus).toBe("approval_required");
    expect(runtimePayload.supervisionWorkspaceRefreshOutput).toContain(
      "console.attention.preset.inbox"
    );
    expect(runtimePayload.supervisionWorkspaceRefreshOutput).toContain('"scope": "route"');
    expect(runtimePayload.supervisionWorkspaceRefreshOutput).toContain('"routeKey": "ticketList"');
    expect(runtimePayload.supervisionWorkspaceBlockedStatus).toBe("blocked");
    expect(runtimePayload.supervisionWorkspaceBlockedOutput).toContain(
      "console.attention.preset.queue"
    );
    expect(runtimePayload.supervisionWorkspaceBlockedOutput).toContain('"scope": "route"');
    expect(runtimePayload.supervisionWorkspaceBlockedOutput).toContain('"status": "blocked"');
    expect(runtimePayload.supervisionWorkspaceRefreshBlockedStatus).toBe("blocked");
    expect(runtimePayload.supervisionWorkspaceRefreshBlockedOutput).toContain(
      "console.attention.preset.queue"
    );
    expect(runtimePayload.supervisionWorkspaceRefreshBlockedOutput).toContain('"status": "blocked"');
    expect(runtimePayload.supervisionWorkspaceInboxStatus).toBe("approval_required");
    expect(runtimePayload.supervisionWorkspaceInboxOutput).toContain(
      "console.attention.preset.inbox"
    );
    expect(runtimePayload.supervisionWorkspaceInboxOutput).toContain('"scope": "route"');
    expect(runtimePayload.supervisionWorkspaceHistoryResumeStatus).toBe("blocked");
    expect(runtimePayload.supervisionWorkspaceHistoryResumeOutput).toContain(
      "console.attention.preset.queue"
    );
    expect(runtimePayload.supervisionWorkspaceHistoryResumeOutput).toContain('"scope": "resource"');
    expect(runtimePayload.supervisionWorkspaceAfterClearActiveTrail).toContain(
      "Pinned Workspace"
    );
    expect(runtimePayload.supervisionWorkspaceAfterClearActiveTrail).toContain(
      "Resource Attention"
    );
    expect(runtimePayload.supervisionWorkspaceAfterClearActiveCount).toBe("2 saved");
    expect(runtimePayload.supervisionWorkspaceAfterClearHistoryTrail).toContain(
      "No Pinned Workspace"
    );
    expect(runtimePayload.supervisionWorkspaceAfterClearHistoryText).toContain(
      "No Saved Workspaces"
    );
    expect(runtimePayload.supervisionWorkspaceAfterClearHistoryCount).toBe("0 saved");
    expect(runtimePayload.supervisionWorkspaceRefreshDisabledAfterClear).toBe(true);
    expect(runtimePayload.attentionOutput).toContain("route.attention");
    expect(runtimePayload.attentionOutput).toContain('"handoff"');
    expect(runtimePayload.attentionOutput).toContain('"parent"');
    expect(runtimePayload.resourceHandoffReturnStatus).toBe("blocked");
    expect(runtimePayload.resourceHandoffReturnOutput).toContain(
      "console.attention.preset.queue"
    );
    expect(runtimePayload.resourceHandoffReturnOutput).toContain('"scope": "resource"');
    expect(runtimePayload.resourceHandoffReturnOutput).toContain('"status": "blocked"');
    expect(runtimePayload.taskHandoffReturnStatus).toBe("approval_required");
    expect(runtimePayload.taskHandoffReturnOutput).toContain(
      "console.attention.preset.inbox"
    );
    expect(runtimePayload.taskHandoffReturnOutput).toContain('"scope": "task"');
    expect(runtimePayload.taskHandoffReturnOutput).toContain('"taskKey": "generateDigestTask"');
    expect(runtimePayload.handoffReturnActiveRoute).toBe("Ticket Queue");
    expect(runtimePayload.consoleAttentionOutput).toContain("openCount");
    expect(runtimePayload.consoleOutput).toContain("approval_required");
  }, 15000);

  it("restores saved supervision workspaces across browser reloads", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-human-attention-restore-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/agent-surface-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/generate-digest.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { generateDigestCapability } from "./generated/generate-digest.js";',
        "",
        "export async function generateDigest(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        '  if (input.mode === "needs_approval" && input.approved !== true) {',
        "    return {",
        "      capability: generateDigestCapability.key,",
        '      status: "approval_required",',
        "      input,",
        '      note: "Manager approval required before digest generation."',
        "    };",
        "  }",
        "",
        '  if (input.mode === "needs_input" && typeof input.ticketId !== "string") {',
        "    return {",
        "      capability: generateDigestCapability.key,",
        '      status: "input_required",',
        "      input,",
        '      note: "Ticket selection is incomplete."',
        "    };",
        "  }",
        "",
        '  if (input.mode === "blocked" && input.unblocked !== true) {',
        "    return {",
        "      capability: generateDigestCapability.key,",
        '      status: "blocked",',
        "      input,",
        '      note: "Execution is blocked by policy."',
        "    };",
        "  }",
        "",
        "  return {",
        "    capability: generateDigestCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        '      reportId: "digest-001",',
        '      ticketId: String(input.ticketId ?? "T-100")',
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
    expect(buildResult.stderr).toBe("");

    const runtimeCheckPath = join(outputDir, "attention-restore-runtime-check.mjs");
    await writeFile(
      runtimeCheckPath,
      [
        'import { readFile } from "node:fs/promises";',
        'import { pathToFileURL } from "node:url";',
        "",
        `const jsdomModuleUrl = ${JSON.stringify(pathToFileURL(join(repoRoot, "node_modules/jsdom/lib/api.js")).href)};`,
        'const { JSDOM } = await import(jsdomModuleUrl);',
        'const outputDir = process.argv[2];',
        'const controlPlaneModule = await import(pathToFileURL(`${outputDir}/dist/control-plane/index.js`).href);',
        'const humanSurfaceModule = await import(pathToFileURL(`${outputDir}/dist/human-surface/index.js`).href);',
        'await controlPlaneModule.startTaskAction("ticketList", "generateDigest", { ticketId: "T-201", mode: "needs_approval" });',
        'await controlPlaneModule.startTaskAction("ticketList", "generateDigest", { mode: "needs_input" });',
        'await controlPlaneModule.startTaskAction("ticketList", "generateDigest", { ticketId: "T-202", mode: "blocked" });',
        'const html = await readFile(`${outputDir}/human-surface.html`, "utf8");',
        'const firstDom = new JSDOM(html, { url: "http://capstan.local/#workspaceHome" });',
        'humanSurfaceModule.mountHumanSurfaceBrowser(firstDom.window.document);',
        'firstDom.window.document.querySelector(\'[data-console-attention-preset-inbox="task:generateDigestTask"]\')?.click();',
        'await new Promise((resolve) => firstDom.window.setTimeout(resolve, 0));',
        'const taskAutoSlotOutput = firstDom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'firstDom.window.document.querySelector(\'[data-console-attention-preset-queue="resource:ticket"][data-console-attention-preset-status="blocked"]\')?.click();',
        'await new Promise((resolve) => firstDom.window.setTimeout(resolve, 0));',
        'const resourceAutoSlotOutput = firstDom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'firstDom.window.document.querySelector(\'[data-console-attention-preset-inbox="route:ticketList"]\')?.click();',
        'await new Promise((resolve) => firstDom.window.setTimeout(resolve, 0));',
        'const routeAutoSlotOutput = firstDom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'const autoSlotText = firstDom.window.document.querySelector("[data-console-supervision-slots]")?.textContent ?? "";',
        'const autoSlotSummaryCount = firstDom.window.document.querySelector("[data-console-supervision-slot-summary-count]")?.textContent ?? "";',
        'const autoSlotSummaryText = firstDom.window.document.querySelector("[data-console-supervision-slot-summaries]")?.textContent ?? "";',
        'firstDom.window.document.querySelector(\'[data-console-supervision-slot-save="primary"]\')?.click();',
        'await new Promise((resolve) => firstDom.window.setTimeout(resolve, 0));',
        'const manualPrimarySlotText = firstDom.window.document.querySelector("[data-console-supervision-slots]")?.textContent ?? "";',
        'firstDom.window.document.querySelector(\'[data-console-attention-preset-inbox="task:generateDigestTask"]\')?.click();',
        'await new Promise((resolve) => firstDom.window.setTimeout(resolve, 0));',
        'const taskAfterManualPrimaryOutput = firstDom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'firstDom.window.document.querySelector(\'[data-console-supervision-slot-open="primary"]\')?.click();',
        'await new Promise((resolve) => firstDom.window.setTimeout(resolve, 0));',
        'const firstHistoryCount = firstDom.window.document.querySelector("[data-console-supervision-history-count]")?.textContent ?? "";',
        'const firstSlotText = firstDom.window.document.querySelector("[data-console-supervision-slots]")?.textContent ?? "";',
        'const savedStorageEntries = Array.from({ length: firstDom.window.localStorage.length }, (_, index) => firstDom.window.localStorage.key(index)).filter((key) => Boolean(key)).map((key) => [key, firstDom.window.localStorage.getItem(key) ?? ""]);',
        'const savedWorkspaceEntry = savedStorageEntries.find(([key]) => key.includes("capstan:human-surface:supervision:")) ?? null;',
        'const secondDom = new JSDOM(html, { url: "http://capstan.local/" });',
        'savedStorageEntries.forEach(([key, value]) => { secondDom.window.localStorage.setItem(key, value); });',
        'const restoredRuntime = humanSurfaceModule.mountHumanSurfaceBrowser(secondDom.window.document);',
        'const restoredWorkspaceTrail = secondDom.window.document.querySelector("[data-console-supervision-trail]")?.textContent ?? "";',
        'const restoredWorkspaceCopy = secondDom.window.document.querySelector("[data-console-supervision-copy]")?.textContent ?? "";',
        'const restoredWorkspaceHistoryCount = secondDom.window.document.querySelector("[data-console-supervision-history-count]")?.textContent ?? "";',
        'const restoredSlotText = secondDom.window.document.querySelector("[data-console-supervision-slots]")?.textContent ?? "";',
        'const restoredSlotSummaryCount = secondDom.window.document.querySelector("[data-console-supervision-slot-summary-count]")?.textContent ?? "";',
        'const restoredSlotSummaryText = secondDom.window.document.querySelector("[data-console-supervision-slot-summaries]")?.textContent ?? "";',
        'const restoredRoute = secondDom.window.document.querySelector("[data-console-route]")?.textContent ?? "";',
        'const restoredConsoleOutput = secondDom.window.document.querySelector("[data-console-output]")?.textContent ?? "";',
        'const restoredSlotSummaries = restoredRuntime.supervisionWorkspaceSlotSummaries.map((summary) => ({ key: summary.key, openCount: summary.openCount, newOpenCount: summary.newOpenCount, topQueueStatus: summary.topQueue?.status ?? null, topQueueNewOpenCount: summary.topQueue?.newOpenCount ?? 0, mode: summary.mode ?? null }));',
        'const restoredAttentionStatus = secondDom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const restoredAttentionOutput = secondDom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'await controlPlaneModule.startTaskAction("ticketList", "generateDigest", { ticketId: "T-203", mode: "needs_approval" });',
        'secondDom.window.document.querySelector(\'[data-console-attention-inbox="workflowAttentionInbox"]\')?.click();',
        'await new Promise((resolve) => secondDom.window.setTimeout(resolve, 0));',
        'const deltaSlotSummaryCount = secondDom.window.document.querySelector("[data-console-supervision-slot-summary-count]")?.textContent ?? "";',
        'const deltaSlotSummaryText = secondDom.window.document.querySelector("[data-console-supervision-slot-summaries]")?.textContent ?? "";',
        'const deltaSlotSummaries = restoredRuntime.supervisionWorkspaceSlotSummaries.map((summary) => ({ key: summary.key, openCount: summary.openCount, newOpenCount: summary.newOpenCount, topQueueStatus: summary.topQueue?.status ?? null, topQueueNewOpenCount: summary.topQueue?.newOpenCount ?? 0, mode: summary.mode ?? null }));',
        'secondDom.window.document.querySelector(\'[data-console-supervision-slot-summary-open="primary"]\')?.click();',
        'await new Promise((resolve) => secondDom.window.setTimeout(resolve, 0));',
        'const primarySlotStatus = secondDom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const primarySlotOutput = secondDom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'const primarySeenSlotSummaryCount = secondDom.window.document.querySelector("[data-console-supervision-slot-summary-count]")?.textContent ?? "";',
        'const primarySeenSlotSummaries = restoredRuntime.supervisionWorkspaceSlotSummaries.map((summary) => ({ key: summary.key, newOpenCount: summary.newOpenCount }));',
        'secondDom.window.document.querySelector(\'[data-console-supervision-slot-summary-queue="secondary"]\')?.click();',
        'await new Promise((resolve) => secondDom.window.setTimeout(resolve, 0));',
        'const secondarySlotStatus = secondDom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const secondarySlotOutput = secondDom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'const secondarySeenSlotSummaryCount = secondDom.window.document.querySelector("[data-console-supervision-slot-summary-count]")?.textContent ?? "";',
        'const secondarySeenSlotSummaryText = secondDom.window.document.querySelector("[data-console-supervision-slot-summaries]")?.textContent ?? "";',
        'const secondarySeenSlotSummaries = restoredRuntime.supervisionWorkspaceSlotSummaries.map((summary) => ({ key: summary.key, newOpenCount: summary.newOpenCount }));',
        'secondDom.window.document.querySelector(\'[data-console-supervision-slot-clear="watchlist"]\')?.click();',
        'await new Promise((resolve) => secondDom.window.setTimeout(resolve, 0));',
        'const slotTextAfterWatchlistClear = secondDom.window.document.querySelector("[data-console-supervision-slots]")?.textContent ?? "";',
        'const slotSummaryTextAfterWatchlistClear = secondDom.window.document.querySelector("[data-console-supervision-slot-summaries]")?.textContent ?? "";',
        'secondDom.window.document.querySelector("[data-console-supervision-refresh]")?.click();',
        'await new Promise((resolve) => secondDom.window.setTimeout(resolve, 0));',
        'const refreshedAttentionStatus = secondDom.window.document.querySelector("[data-console-attention-status]")?.textContent ?? "";',
        'const refreshedAttentionOutput = secondDom.window.document.querySelector("[data-console-attention-output]")?.textContent ?? "";',
        'secondDom.window.document.querySelector("[data-console-supervision-clear-history]")?.click();',
        'await new Promise((resolve) => secondDom.window.setTimeout(resolve, 0));',
        'const storageRetainedAfterHistoryClear = savedWorkspaceEntry ? secondDom.window.localStorage.getItem(savedWorkspaceEntry[0]) !== null : false;',
        'const thirdDom = new JSDOM(html, { url: "http://capstan.local/" });',
        'Array.from({ length: secondDom.window.localStorage.length }, (_, index) => secondDom.window.localStorage.key(index)).filter((key) => Boolean(key)).forEach((key) => { thirdDom.window.localStorage.setItem(key, secondDom.window.localStorage.getItem(key) ?? ""); });',
        'const emptyRuntime = humanSurfaceModule.mountHumanSurfaceBrowser(thirdDom.window.document);',
        'const emptyHistoryCount = thirdDom.window.document.querySelector("[data-console-supervision-history-count]")?.textContent ?? "";',
        'const emptyTrail = thirdDom.window.document.querySelector("[data-console-supervision-trail]")?.textContent ?? "";',
        'const reloadedSlotText = thirdDom.window.document.querySelector("[data-console-supervision-slots]")?.textContent ?? "";',
        'process.stdout.write(JSON.stringify({',
        '  taskAutoSlotOutput,',
        '  resourceAutoSlotOutput,',
        '  routeAutoSlotOutput,',
        '  autoSlotText,',
        '  autoSlotSummaryCount,',
        '  autoSlotSummaryText,',
        '  manualPrimarySlotText,',
        '  taskAfterManualPrimaryOutput,',
        '  firstHistoryCount,',
        '  firstSlotText,',
        '  savedWorkspaceStorageKey: savedWorkspaceEntry?.[0] ?? "",',
        '  savedWorkspaceStorageValue: savedWorkspaceEntry?.[1] ?? "",',
        '  restoredActiveRouteKey: restoredRuntime.activeRouteKey,',
        '  restoredWorkspaceKey: restoredRuntime.supervisionWorkspace?.preset.key ?? "",',
        '  restoredWorkspaceHistoryKeys: restoredRuntime.supervisionWorkspaceHistory.map((entry) => entry.preset.key),',
        '  restoredWorkspaceTrail,',
        '  restoredWorkspaceCopy,',
        '  restoredWorkspaceHistoryCount,',
        '  restoredSlotText,',
        '  restoredSlotSummaryCount,',
        '  restoredSlotSummaryText,',
        '  restoredRoute,',
        '  restoredConsoleOutput,',
        '  restoredSlotSummaries,',
        '  restoredAttentionStatus,',
        '  restoredAttentionOutput,',
        '  deltaSlotSummaryCount,',
        '  deltaSlotSummaryText,',
        '  deltaSlotSummaries,',
        '  primarySlotStatus,',
        '  primarySlotOutput,',
        '  primarySeenSlotSummaryCount,',
        '  primarySeenSlotSummaries,',
        '  secondarySlotStatus,',
        '  secondarySlotOutput,',
        '  secondarySeenSlotSummaryCount,',
        '  secondarySeenSlotSummaryText,',
        '  secondarySeenSlotSummaries,',
        '  slotTextAfterWatchlistClear,',
        '  slotSummaryTextAfterWatchlistClear,',
        '  refreshedAttentionStatus,',
        '  refreshedAttentionOutput,',
        '  storageRetainedAfterHistoryClear,',
        '  emptyHistoryLength: emptyRuntime.supervisionWorkspaceHistory.length,',
        '  emptyHistoryCount,',
        '  emptyTrail,',
        '  reloadedSlotText,',
        '}, null, 2));'
      ].join("\n"),
      "utf8"
    );

    const { stdout, stderr } = await execFileAsync(process.execPath, [runtimeCheckPath, outputDir], {
      cwd: repoRoot
    });
    const runtimePayload = JSON.parse(stdout) as {
      taskAutoSlotOutput: string;
      resourceAutoSlotOutput: string;
      routeAutoSlotOutput: string;
      autoSlotText: string;
      autoSlotSummaryCount: string;
      autoSlotSummaryText: string;
      manualPrimarySlotText: string;
      taskAfterManualPrimaryOutput: string;
      firstHistoryCount: string;
      firstSlotText: string;
      savedWorkspaceStorageKey: string;
      savedWorkspaceStorageValue: string;
      restoredActiveRouteKey: string;
      restoredWorkspaceKey: string;
      restoredWorkspaceHistoryKeys: string[];
      restoredWorkspaceTrail: string;
      restoredWorkspaceCopy: string;
      restoredWorkspaceHistoryCount: string;
      restoredSlotText: string;
      restoredSlotSummaryCount: string;
      restoredSlotSummaryText: string;
      restoredRoute: string;
      restoredConsoleOutput: string;
      restoredSlotSummaries: Array<{
        key: string;
        openCount: number;
        newOpenCount: number;
        topQueueStatus: string | null;
        topQueueNewOpenCount: number;
        mode: string | null;
      }>;
      restoredAttentionStatus: string;
      restoredAttentionOutput: string;
      deltaSlotSummaryCount: string;
      deltaSlotSummaryText: string;
      deltaSlotSummaries: Array<{
        key: string;
        openCount: number;
        newOpenCount: number;
        topQueueStatus: string | null;
        topQueueNewOpenCount: number;
        mode: string | null;
      }>;
      primarySlotStatus: string;
      primarySlotOutput: string;
      primarySeenSlotSummaryCount: string;
      primarySeenSlotSummaries: Array<{
        key: string;
        newOpenCount: number;
      }>;
      secondarySlotStatus: string;
      secondarySlotOutput: string;
      secondarySeenSlotSummaryCount: string;
      secondarySeenSlotSummaryText: string;
      secondarySeenSlotSummaries: Array<{
        key: string;
        newOpenCount: number;
      }>;
      slotTextAfterWatchlistClear: string;
      slotSummaryTextAfterWatchlistClear: string;
      refreshedAttentionStatus: string;
      refreshedAttentionOutput: string;
      storageRetainedAfterHistoryClear: boolean;
      emptyHistoryLength: number;
      emptyHistoryCount: string;
      emptyTrail: string;
      reloadedSlotText: string;
    };

    expect(stderr).toBe("");
    expect(runtimePayload.taskAutoSlotOutput).toContain('"workspaceSlot"');
    expect(runtimePayload.taskAutoSlotOutput).toContain('"key": "primary"');
    expect(runtimePayload.taskAutoSlotOutput).toContain('"mode": "auto"');
    expect(runtimePayload.resourceAutoSlotOutput).toContain('"key": "secondary"');
    expect(runtimePayload.resourceAutoSlotOutput).toContain('"mode": "auto"');
    expect(runtimePayload.routeAutoSlotOutput).toContain('"key": "watchlist"');
    expect(runtimePayload.routeAutoSlotOutput).toContain('"mode": "auto"');
    expect(runtimePayload.autoSlotText).toContain("Primary");
    expect(runtimePayload.autoSlotText).toContain("Secondary");
    expect(runtimePayload.autoSlotText).toContain("Watchlist");
    expect(runtimePayload.autoSlotText).toContain("Auto Slot");
    expect(runtimePayload.autoSlotSummaryCount).toBe("3 active");
    expect(runtimePayload.autoSlotSummaryText).toContain("Needs Attention");
    expect(runtimePayload.autoSlotSummaryText).toContain("No New Attention");
    expect(runtimePayload.autoSlotSummaryText).toContain("Approval Required");
    expect(runtimePayload.autoSlotSummaryText).toContain("highest-priority approval required lane");
    expect(runtimePayload.autoSlotSummaryText).toContain("Open Approval Required Queue");
    expect(runtimePayload.manualPrimarySlotText).toContain("Primary");
    expect(runtimePayload.manualPrimarySlotText).toContain("Manual Slot");
    expect(runtimePayload.taskAfterManualPrimaryOutput).toContain('"key": "primary"');
    expect(runtimePayload.taskAfterManualPrimaryOutput).toContain('"mode": "manual"');
    expect(runtimePayload.taskAfterManualPrimaryOutput).toContain(
      '"savedWorkspace": "route:ticketList"'
    );
    expect(runtimePayload.firstHistoryCount).toBe("4 saved");
    expect(runtimePayload.firstSlotText).toContain("Primary");
    expect(runtimePayload.firstSlotText).toContain("Secondary");
    expect(runtimePayload.firstSlotText).toContain("Watchlist");
    expect(runtimePayload.firstSlotText).toContain("Manual Slot");
    expect(runtimePayload.firstSlotText).toContain("Auto Slot");
    expect(runtimePayload.savedWorkspaceStorageKey).toContain(
      "capstan:human-surface:supervision:"
    );
    expect(runtimePayload.savedWorkspaceStorageValue).toContain('"version":4');
    expect(runtimePayload.savedWorkspaceStorageValue).toContain('"slots"');
    expect(runtimePayload.savedWorkspaceStorageValue).toContain('"mode":"manual"');
    expect(runtimePayload.savedWorkspaceStorageValue).toContain('"mode":"auto"');
    expect(runtimePayload.savedWorkspaceStorageValue).toContain('"seenAttentionIds"');
    expect(runtimePayload.restoredActiveRouteKey).toBe("ticketList");
    expect(runtimePayload.restoredWorkspaceTrail).toContain("Pinned Workspace");
    expect(runtimePayload.restoredWorkspaceTrail).toContain("Task Attention");
    expect(runtimePayload.restoredWorkspaceTrail).toContain("Resource Attention");
    expect(runtimePayload.restoredWorkspaceTrail).toContain("Route Attention");
    expect(runtimePayload.restoredWorkspaceCopy).toContain(
      'Pinned from task attention preset "Generate Ticket Digest"'
    );
    expect(runtimePayload.restoredWorkspaceCopy).toContain(
      'into route attention preset "Ticket Queue"'
    );
    expect(runtimePayload.restoredWorkspaceHistoryCount).toBe("4 saved");
    expect(runtimePayload.restoredSlotText).toContain("Primary");
    expect(runtimePayload.restoredSlotText).toContain("Secondary");
    expect(runtimePayload.restoredSlotText).toContain("Watchlist");
    expect(runtimePayload.restoredSlotText).toContain("Manual Slot");
    expect(runtimePayload.restoredSlotText).toContain("Auto Slot");
    expect(runtimePayload.restoredSlotText).toContain("Open Active Slot");
    expect(runtimePayload.restoredSlotSummaryCount).toBe("3 active");
    expect(runtimePayload.restoredSlotSummaryText).toContain("Needs Attention");
    expect(runtimePayload.restoredSlotSummaryText).toContain("No New Attention");
    expect(runtimePayload.restoredSlotSummaryText).toContain("Approval Required");
    expect(runtimePayload.restoredSlotSummaryText).toContain("Open Approval Required Queue");
    expect(runtimePayload.restoredRoute).toBe("Ticket Queue");
    expect(runtimePayload.restoredConsoleOutput).toContain('"restoredSupervisionWorkspaces": 4');
    expect(runtimePayload.restoredConsoleOutput).toContain('"restoredSupervisionWorkspaceSlots": 3');
    expect(runtimePayload.restoredConsoleOutput).toContain('"supervisionWorkspaceSlotSummaries"');
    expect(runtimePayload.restoredConsoleOutput).toContain(
      '"activeSupervisionWorkspace": "route:ticketList"'
    );
    expect(runtimePayload.restoredSlotSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "primary",
          openCount: 3,
          newOpenCount: 0,
          topQueueStatus: "approval_required",
          topQueueNewOpenCount: 0,
          mode: "manual"
        }),
        expect.objectContaining({
          key: "secondary",
          openCount: 3,
          newOpenCount: 0,
          topQueueStatus: "approval_required",
          topQueueNewOpenCount: 0,
          mode: "auto"
        }),
        expect.objectContaining({
          key: "watchlist",
          openCount: 3,
          newOpenCount: 0,
          topQueueStatus: "approval_required",
          topQueueNewOpenCount: 0,
          mode: "auto"
        })
      ])
    );
    expect(runtimePayload.restoredAttentionStatus).toBe("approval_required");
    expect(runtimePayload.restoredAttentionOutput).toContain("console.attention.preset.inbox");
    expect(runtimePayload.restoredAttentionOutput).toContain('"routeKey": "ticketList"');
    expect(runtimePayload.deltaSlotSummaryCount).toBe("3 active · 3 new");
    expect(runtimePayload.deltaSlotSummaryText).toContain("New Attention");
    expect(runtimePayload.deltaSlotSummaryText).toContain("1 New Since Open");
    expect(runtimePayload.deltaSlotSummaryText).toContain("Open Slot Summary · +1 new");
    expect(runtimePayload.deltaSlotSummaryText).toContain("Open Approval Required Queue · +1 new");
    expect(runtimePayload.deltaSlotSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "primary",
          openCount: 4,
          newOpenCount: 1,
          topQueueStatus: "approval_required",
          topQueueNewOpenCount: 1,
          mode: "manual"
        }),
        expect.objectContaining({
          key: "secondary",
          openCount: 4,
          newOpenCount: 1,
          topQueueStatus: "approval_required",
          topQueueNewOpenCount: 1,
          mode: "auto"
        }),
        expect.objectContaining({
          key: "watchlist",
          openCount: 4,
          newOpenCount: 1,
          topQueueStatus: "approval_required",
          topQueueNewOpenCount: 1,
          mode: "auto"
        })
      ])
    );
    expect(runtimePayload.primarySlotStatus).toBe("approval_required");
    expect(runtimePayload.primarySlotOutput).toContain("console.attention.preset.inbox");
    expect(runtimePayload.primarySlotOutput).toContain('"scope": "route"');
    expect(runtimePayload.primarySeenSlotSummaryCount).toBe("3 active · 1 new");
    expect(runtimePayload.primarySeenSlotSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "primary",
          newOpenCount: 0
        }),
        expect.objectContaining({
          key: "secondary",
          newOpenCount: 1
        }),
        expect.objectContaining({
          key: "watchlist",
          newOpenCount: 0
        })
      ])
    );
    expect(runtimePayload.secondarySlotStatus).toBe("approval_required");
    expect(runtimePayload.secondarySlotOutput).toContain("console.attention.preset.queue");
    expect(runtimePayload.secondarySlotOutput).toContain('"scope": "resource"');
    expect(runtimePayload.secondarySlotOutput).toContain('"status": "approval_required"');
    expect(runtimePayload.secondarySeenSlotSummaryCount).toBe("3 active");
    expect(runtimePayload.secondarySeenSlotSummaryText).toContain("No New Attention");
    expect(runtimePayload.secondarySeenSlotSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "primary",
          newOpenCount: 0
        }),
        expect.objectContaining({
          key: "secondary",
          newOpenCount: 0
        }),
        expect.objectContaining({
          key: "watchlist",
          newOpenCount: 0
        })
      ])
    );
    expect(runtimePayload.slotTextAfterWatchlistClear).toContain("Watchlist");
    expect(runtimePayload.slotTextAfterWatchlistClear).toContain("Empty Slot");
    expect(runtimePayload.slotSummaryTextAfterWatchlistClear).toContain("Watchlist");
    expect(runtimePayload.slotSummaryTextAfterWatchlistClear).toContain("No Workspace");
    expect(runtimePayload.slotSummaryTextAfterWatchlistClear).toContain("No New Attention");
    expect(runtimePayload.refreshedAttentionStatus).toBe("approval_required");
    expect(runtimePayload.refreshedAttentionOutput).toContain('"scope": "resource"');
    expect(runtimePayload.refreshedAttentionOutput).toContain('"status": "approval_required"');
    expect(runtimePayload.storageRetainedAfterHistoryClear).toBe(true);
    expect(runtimePayload.emptyHistoryLength).toBe(0);
    expect(runtimePayload.emptyHistoryCount).toBe("0 saved");
    expect(runtimePayload.emptyTrail).toContain("No Pinned Workspace");
    expect(runtimePayload.reloadedSlotText).toContain("Primary");
    expect(runtimePayload.reloadedSlotText).toContain("Secondary");
    expect(runtimePayload.reloadedSlotText).toContain("Watchlist");
    expect(runtimePayload.reloadedSlotText).toContain("Manual Slot");
    expect(runtimePayload.reloadedSlotText).toContain("Empty Slot");
  }, 15_000);
});

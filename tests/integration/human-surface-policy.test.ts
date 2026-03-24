import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
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

describe("generated human surface policies", () => {
  it("surfaces allowed, approval-gated, blocked, and redacted actions through the route runtime", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-human-policy-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/policy-workflow-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/create-ticket.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { createTicketCapability } from "./generated/create-ticket.js";',
        "",
        "export async function createTicket(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: createTicketCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      records: [",
        "        {",
        '          title: String(input.title ?? "New ticket"),',
        '          status: String(input.status ?? "Open"),',
        '          priority: String(input.priority ?? "normal"),',
        '          owner: String(input.owner ?? "ops")',
        "        }",
        "      ]",
        "    }",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      join(outputDir, "src/capabilities/export-ticket-digest.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { exportTicketDigestCapability } from "./generated/export-ticket-digest.js";',
        "",
        "export async function exportTicketDigest(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: exportTicketDigestCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      records: [",
        "        {",
        '          title: String(input.title ?? "Digest ticket"),',
        '          status: String(input.status ?? "Open"),',
        '          priority: String(input.priority ?? "high"),',
        '          owner: String(input.owner ?? "ops")',
        "        }",
        "      ],",
        '      report: "digest-ready"',
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

    const moduleUrl = `${pathToFileURL(join(outputDir, "dist/human-surface/index.js")).href}?t=${Date.now()}`;
    const { mountHumanSurfaceBrowser } = (await import(moduleUrl)) as {
      mountHumanSurfaceBrowser: (root: Document) => {
        activeRouteKey: string;
      };
    };

    mountHumanSurfaceBrowser(dom.window.document);

    const statusInput = dom.window.document.querySelector<HTMLInputElement>(
      '[data-route-input-key="ticketForm"][data-field-key="status"]'
    );
    const titleInput = dom.window.document.querySelector<HTMLInputElement>(
      '[data-route-input-key="ticketForm"][data-field-key="title"]'
    );
    const priorityInput = dom.window.document.querySelector<HTMLInputElement>(
      '[data-route-input-key="ticketForm"][data-field-key="priority"]'
    );
    const ownerInput = dom.window.document.querySelector<HTMLInputElement>(
      '[data-route-input-key="ticketForm"][data-field-key="owner"]'
    );

    statusInput!.value = "Open";
    titleInput!.value = "Payment failed";
    priorityInput!.value = "high";
    ownerInput!.value = "Lina";

    dom.window.document
      .querySelector<HTMLButtonElement>(
        '[data-route-action="ticketForm"][data-action-key="createTicket"]'
      )
      ?.click();

    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    const resultStatus = dom.window.document.querySelector('[data-route-result-status="ticketForm"]');
    expect(resultStatus?.textContent).toBe("completed");
    expect(resultStatus?.getAttribute("data-route-result-state")).toBe("completed");
    expect(
      dom.window.document.querySelector('[data-route-table-body="ticketList"]')?.textContent
    ).toContain("Payment failed");

    dom.window.document
      .querySelector<HTMLButtonElement>(
        '[data-route-action="ticketForm"][data-action-key="exportTicketDigest"]'
      )
      ?.click();

    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(resultStatus?.textContent).toBe("redacted");
    expect(resultStatus?.getAttribute("data-route-result-state")).toBe("redacted");
    expect(
      dom.window.document.querySelector('[data-route-result-output="ticketForm"]')?.textContent
    ).toContain("flagged as redacted");

    dom.window.document
      .querySelector<HTMLButtonElement>(
        '[data-route-action="ticketForm"][data-action-key="escalateTicket"]'
      )
      ?.click();

    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(resultStatus?.textContent).toBe("approval_required");
    expect(resultStatus?.getAttribute("data-route-result-state")).toBe("approval_required");
    expect(
      dom.window.document.querySelector('[data-route-mode-label="ticketForm"]')?.textContent
    ).toBe("empty");
    expect(dom.window.document.querySelector("[data-console-output]")?.textContent).toContain(
      "capability.pending_approval"
    );

    dom.window.document
      .querySelector<HTMLButtonElement>(
        '[data-route-action="ticketForm"][data-action-key="deleteTicket"]'
      )
      ?.click();

    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(resultStatus?.textContent).toBe("blocked");
    expect(resultStatus?.getAttribute("data-route-result-state")).toBe("blocked");
    expect(
      dom.window.document.querySelector('[data-route-mode-label="ticketForm"]')?.textContent
    ).toBe("error");
    expect(dom.window.document.querySelector("[data-console-output]")?.textContent).toContain(
      "capability.blocked"
    );
  }, 15_000);
});

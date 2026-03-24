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

describe("generated human surface multi-resource workflows", () => {
  it("keeps customer and ticket projections isolated while both workflows execute in one app", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-human-multi-resource-"));
    tempDirs.push(outputDir);

    const scaffoldResult = await runCapstanCli([
      "graph:scaffold",
      "./tests/fixtures/graphs/multi-resource-workflow-app-graph.json",
      outputDir
    ]);

    expect(scaffoldResult.exitCode).toBe(0);

    await writeFile(
      join(outputDir, "src/capabilities/create-customer.ts"),
      [
        'import type { CapabilityExecutionResult } from "../types.js";',
        'import { createCustomerCapability } from "./generated/create-customer.js";',
        "",
        "export async function createCustomer(",
        "  input: Record<string, unknown> = {}",
        "): Promise<CapabilityExecutionResult> {",
        "  return {",
        "    capability: createCustomerCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        "      records: [",
        "        {",
        '          name: String(input.name ?? "Acme Retail"),',
        '          tier: String(input.tier ?? "gold"),',
        '          email: String(input.email ?? "ops@acme.test")',
        "        }",
        "      ]",
        "    }",
        "  };",
        "}"
      ].join("\n"),
      "utf8"
    );

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
        '          title: String(input.title ?? "Payment failed"),',
        '          status: String(input.status ?? "Open"),',
        '          priority: String(input.priority ?? "high")',
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
      url: "http://capstan.local/#customerForm"
    });

    const moduleUrl = `${pathToFileURL(join(outputDir, "dist/human-surface/index.js")).href}?t=${Date.now()}`;
    const { mountHumanSurfaceBrowser } = (await import(moduleUrl)) as {
      mountHumanSurfaceBrowser: (root: Document) => {
        activeRouteKey: string;
      };
    };

    mountHumanSurfaceBrowser(dom.window.document);

    const customerNameInput = dom.window.document.querySelector<HTMLInputElement>(
      '[data-route-input-key="customerForm"][data-field-key="name"]'
    );
    const customerTierInput = dom.window.document.querySelector<HTMLInputElement>(
      '[data-route-input-key="customerForm"][data-field-key="tier"]'
    );
    const customerEmailInput = dom.window.document.querySelector<HTMLInputElement>(
      '[data-route-input-key="customerForm"][data-field-key="email"]'
    );

    customerNameInput!.value = "Acme Retail";
    customerTierInput!.value = "gold";
    customerEmailInput!.value = "ops@acme.test";

    dom.window.document
      .querySelector<HTMLButtonElement>(
        '[data-route-action="customerForm"][data-action-key="createCustomer"]'
      )
      ?.click();

    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(
      dom.window.document.querySelector('[data-route-result-status="customerForm"]')?.textContent
    ).toBe("completed");
    expect(
      dom.window.document.querySelector('[data-route-result-output="customerForm"]')?.textContent
    ).toContain("Acme Retail");

    dom.window.document
      .querySelector<HTMLElement>('[data-route-nav="customerList"]')
      ?.click();

    expect(dom.window.location.hash).toBe("#customerList");
    expect(
      dom.window.document.querySelector('[data-route-table-body="customerList"]')?.textContent
    ).toContain("Acme Retail");
    expect(
      dom.window.document.querySelector('[data-route-table-body="customerList"]')?.textContent
    ).toContain("gold");

    expect(
      dom.window.document.querySelector('[data-route-table-body="ticketList"]')?.textContent
    ).toContain("Title sample");
    expect(
      dom.window.document.querySelector('[data-route-table-body="ticketList"]')?.textContent
    ).not.toContain("Acme Retail");

    dom.window.document
      .querySelector<HTMLElement>('[data-route-nav="customerDetail"]')
      ?.click();

    expect(
      dom.window.document.querySelector(
        '[data-route-detail-value-route="customerDetail"][data-field-key="name"]'
      )?.textContent
    ).toBe("Acme Retail");

    dom.window.document
      .querySelector<HTMLElement>('[data-route-nav="ticketForm"]')
      ?.click();

    const ticketTitleInput = dom.window.document.querySelector<HTMLInputElement>(
      '[data-route-input-key="ticketForm"][data-field-key="title"]'
    );
    const ticketStatusInput = dom.window.document.querySelector<HTMLInputElement>(
      '[data-route-input-key="ticketForm"][data-field-key="status"]'
    );
    const ticketPriorityInput = dom.window.document.querySelector<HTMLInputElement>(
      '[data-route-input-key="ticketForm"][data-field-key="priority"]'
    );

    ticketTitleInput!.value = "Payment failed";
    ticketStatusInput!.value = "Open";
    ticketPriorityInput!.value = "high";

    dom.window.document
      .querySelector<HTMLButtonElement>(
        '[data-route-action="ticketForm"][data-action-key="createTicket"]'
      )
      ?.click();

    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    expect(
      dom.window.document.querySelector('[data-route-result-status="ticketForm"]')?.textContent
    ).toBe("completed");
    expect(
      dom.window.document.querySelector('[data-route-result-output="ticketForm"]')?.textContent
    ).toContain("Payment failed");

    dom.window.document
      .querySelector<HTMLElement>('[data-route-nav="ticketList"]')
      ?.click();

    expect(
      dom.window.document.querySelector('[data-route-table-body="ticketList"]')?.textContent
    ).toContain("Payment failed");
    expect(
      dom.window.document.querySelector('[data-route-table-body="ticketList"]')?.textContent
    ).toContain("Open");
    expect(
      dom.window.document.querySelector('[data-route-table-body="customerList"]')?.textContent
    ).toContain("Acme Retail");

    dom.window.document
      .querySelector<HTMLElement>('[data-route-nav="ticketDetail"]')
      ?.click();

    expect(
      dom.window.document.querySelector(
        '[data-route-detail-value-route="ticketDetail"][data-field-key="title"]'
      )?.textContent
    ).toBe("Payment failed");

    dom.window.document
      .querySelector<HTMLElement>('[data-route-nav="customerDetail"]')
      ?.click();

    expect(
      dom.window.document.querySelector(
        '[data-route-detail-value-route="customerDetail"][data-field-key="name"]'
      )?.textContent
    ).toBe("Acme Retail");
    expect(
      dom.window.document.querySelector(
        '[data-route-detail-value-route="customerDetail"][data-field-key="tier"]'
      )?.textContent
    ).toBe("gold");
  }, 15_000);
});

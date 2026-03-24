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

describe("generated agent surface auth hooks", () => {
  it("supports deny, approve, and redact decisions before executing the transport request", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-agent-auth-"));
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
        "  return {",
        "    capability: generateDigestCapability.key,",
        '    status: "completed",',
        "    input,",
        "    output: {",
        '      reportId: "digest-auth-001",',
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

    const moduleUrl = `${pathToFileURL(join(outputDir, "dist/agent-surface/transport.js")).href}?t=${Date.now()}`;
    const transportModule = (await import(moduleUrl)) as {
      createAgentSurfaceTransport: (hooks: {
        authorize: (context: {
          operation: string;
          policyKey?: string;
          capability?: { key: string };
          task?: { key: string };
          artifact?: { key: string };
        }) =>
          | { effect: "allow" | "approve" | "deny" | "redact"; reason?: string; body?: unknown }
          | void;
      }) => {
        handle: (request:
          | { operation: "execute"; key: string; input?: Record<string, unknown> }
          | { operation: "startTask"; key: string; input?: Record<string, unknown> }
          | { operation: "artifact"; key: string }) => Promise<{
            ok: boolean;
            status: number;
            body?: unknown;
            error?: string;
            code?: string;
            details?: unknown;
          }>;
      };
    };

    let observedPolicyKey: string | undefined;
    const guardedTransport = transportModule.createAgentSurfaceTransport({
      authorize(context) {
        if (context.capability?.key === "generateDigest" && context.operation === "execute") {
          observedPolicyKey = context.policyKey;

          return {
            effect: "deny",
            reason: "Digest execution denied for this agent."
          };
        }

        if (context.task?.key === "generateDigestTask" && context.operation === "startTask") {
          return {
            effect: "approve",
            reason: "Manager approval required for durable digest jobs."
          };
        }

        if (context.artifact?.key === "ticketDigest" && context.operation === "artifact") {
          return {
            effect: "redact",
            body: {
              redacted: true,
              artifactKey: context.artifact.key
            }
          };
        }

        return {
          effect: "allow"
        };
      }
    });

    const denied = await guardedTransport.handle({
      operation: "execute",
      key: "generateDigest",
      input: {
        ticketId: "T-7000"
      }
    });
    expect(denied.ok).toBe(false);
    expect(denied.status).toBe(403);
    expect(denied.error).toBe("Digest execution denied for this agent.");
    expect(denied.code).toBe("access_denied");
    expect(observedPolicyKey).toBe("reviewRequired");

    const approvalRequired = await guardedTransport.handle({
      operation: "startTask",
      key: "generateDigestTask",
      input: {
        ticketId: "T-7001"
      }
    });
    expect(approvalRequired.ok).toBe(false);
    expect(approvalRequired.status).toBe(202);
    expect(approvalRequired.error).toBe("Manager approval required for durable digest jobs.");
    expect(approvalRequired.code).toBe("approval_required");
    expect(JSON.stringify(approvalRequired.details)).toContain("reviewRequired");

    const redacted = await guardedTransport.handle({
      operation: "artifact",
      key: "ticketDigest"
    });
    expect(redacted.ok).toBe(true);
    expect(redacted.status).toBe(200);
    expect(JSON.stringify(redacted.body)).toContain('"redacted":true');
    expect(JSON.stringify(redacted.body)).toContain("ticketDigest");
  });
});

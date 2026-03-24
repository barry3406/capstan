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

describe("generated agent surface cross-protocol runtime", () => {
  it("reuses one semantic runtime across HTTP, MCP, and A2A projections", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-agent-cross-"));
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
        "      artifacts: {",
        "        ticketDigest: {",
        '          reportId: `digest-cross-${String(input.ticketId ?? "shared")}` ,',
        '          ticketId: String(input.ticketId ?? "shared")',
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

    const bust = `?t=${Date.now()}`;
    const httpModule = (await import(
      `${pathToFileURL(join(outputDir, "dist/agent-surface/http.js")).href}${bust}`
    )) as {
      handleAgentSurfaceHttpRequest: (request: {
        method: string;
        path: string;
        query?: Record<string, string>;
        body?: unknown;
      }) => Promise<{ status: number; body: string }>;
    };
    const mcpModule = (await import(
      `${pathToFileURL(join(outputDir, "dist/agent-surface/mcp.js")).href}${bust}`
    )) as {
      callAgentSurfaceMcpTool: (
        name: string,
        args?: Record<string, unknown>
      ) => Promise<{ structuredContent?: unknown; isError?: boolean }>;
    };
    const a2aModule = (await import(
      `${pathToFileURL(join(outputDir, "dist/agent-surface/a2a.js")).href}${bust}`
    )) as {
      sendAgentSurfaceA2aMessage: (message: {
        operation:
          | "startTask"
          | "listTaskRuns"
          | "listArtifactRecords";
        params?: Record<string, unknown>;
      }) => Promise<{ state: string; structuredContent?: unknown }>;
    };

    const httpStart = await httpModule.handleAgentSurfaceHttpRequest({
      method: "POST",
      path: "/tasks/generateDigestTask/start",
      body: {
        ticketId: "HTTP-1"
      }
    });
    expect(httpStart.status).toBe(202);

    const mcpStart = await mcpModule.callAgentSurfaceMcpTool("capstan_start_task", {
      key: "generateDigestTask",
      input: {
        ticketId: "MCP-1"
      }
    });
    expect(mcpStart.isError).toBeUndefined();

    const a2aStart = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "startTask",
      params: {
        key: "generateDigestTask",
        input: {
          ticketId: "A2A-1"
        }
      }
    });
    expect(a2aStart.state).toBe("completed");

    const httpRuns = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/task-runs",
      query: {
        taskKey: "generateDigestTask"
      }
    });
    expect(httpRuns.status).toBe(200);
    const httpRunList = JSON.parse(httpRuns.body) as Array<{ id: string }>;
    expect(httpRunList).toHaveLength(3);

    const mcpRuns = await mcpModule.callAgentSurfaceMcpTool("capstan_list_task_runs", {
      taskKey: "generateDigestTask"
    });
    const mcpRunList = mcpRuns.structuredContent as Array<{ id: string }>;
    expect(mcpRunList).toHaveLength(3);

    const a2aRuns = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "listTaskRuns",
      params: {
        taskKey: "generateDigestTask"
      }
    });
    expect(a2aRuns.state).toBe("completed");
    const a2aRunList = a2aRuns.structuredContent as Array<{ id: string }>;
    expect(a2aRunList).toHaveLength(3);

    const httpArtifacts = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/artifact-records",
      query: {
        artifactKey: "ticketDigest"
      }
    });
    expect(httpArtifacts.status).toBe(200);
    const httpArtifactList = JSON.parse(httpArtifacts.body) as Array<{
      payload: { reportId: string };
    }>;
    expect(httpArtifactList).toHaveLength(3);
    expect(httpArtifactList.map((record) => record.payload.reportId)).toEqual([
      "digest-cross-A2A-1",
      "digest-cross-MCP-1",
      "digest-cross-HTTP-1"
    ]);

    const a2aArtifacts = await a2aModule.sendAgentSurfaceA2aMessage({
      operation: "listArtifactRecords",
      params: {
        artifactKey: "ticketDigest"
      }
    });
    expect(a2aArtifacts.state).toBe("completed");
    const a2aArtifactList = a2aArtifacts.structuredContent as Array<{
      payload: { reportId: string };
    }>;
    expect(a2aArtifactList.map((record) => record.payload.reportId)).toEqual([
      "digest-cross-A2A-1",
      "digest-cross-MCP-1",
      "digest-cross-HTTP-1"
    ]);
  }, 15_000);
});

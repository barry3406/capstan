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

describe("generated agent surface mcp adapter", () => {
  it("projects the generated agent surface as MCP tools and tool calls", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-agent-mcp-"));
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
        "      artifacts: {",
        "        ticketDigest: {",
        '          reportId: "digest-mcp-001",',
        '          ticketId: String(input.ticketId ?? "T-MCP")',
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

    const moduleUrl = `${pathToFileURL(join(outputDir, "dist/agent-surface/mcp.js")).href}?t=${Date.now()}`;
    const mcpModule = (await import(moduleUrl)) as {
      listAgentSurfaceMcpTools: () => Array<{ name: string }>;
      callAgentSurfaceMcpTool: (
        name: string,
        args?: Record<string, unknown>
      ) => Promise<{
        content: Array<{ type: string; text: string }>;
        structuredContent?: unknown;
        isError?: boolean;
      }>;
    };

    const tools = mcpModule.listAgentSurfaceMcpTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "capstan_manifest",
      "capstan_resource",
      "capstan_search",
      "capstan_list_attention_items",
      "capstan_list_attention_queues",
      "capstan_execute_action",
      "capstan_start_task_action",
      "capstan_execute",
      "capstan_task",
      "capstan_start_task",
      "capstan_get_task_run",
      "capstan_get_workflow_run",
      "capstan_advance_workflow_run",
      "capstan_list_task_runs",
      "capstan_list_workflow_runs",
      "capstan_artifact",
      "capstan_get_artifact_record",
      "capstan_list_artifact_records"
    ]);

    const manifestResult = await mcpModule.callAgentSurfaceMcpTool("capstan_manifest");
    expect(manifestResult.isError).toBeUndefined();
    expect(JSON.stringify(manifestResult.structuredContent)).toContain('"mcp"');
    expect(JSON.stringify(manifestResult.structuredContent)).toContain('"resources"');

    const resourceResult = await mcpModule.callAgentSurfaceMcpTool("capstan_resource", {
      key: "ticket"
    });
    expect(resourceResult.isError).toBeUndefined();
    expect(JSON.stringify(resourceResult.structuredContent)).toContain('"resource"');
    expect(JSON.stringify(resourceResult.structuredContent)).toContain('"routes"');
    expect(JSON.stringify(resourceResult.structuredContent)).toContain('"actions"');
    expect(JSON.stringify(resourceResult.structuredContent)).toContain('"execution"');
    expect(JSON.stringify(resourceResult.structuredContent)).toContain('"taskStart"');
    expect(JSON.stringify(resourceResult.structuredContent)).toContain('"workflow"');
    expect(JSON.stringify(resourceResult.structuredContent)).toContain('"starter_run_recipe"');
    expect(JSON.stringify(resourceResult.structuredContent)).toContain('"workflowAttention"');

    const actionResult = await mcpModule.callAgentSurfaceMcpTool("capstan_execute_action", {
      routeKey: "ticketList",
      actionKey: "generateDigest",
      input: {
        ticketId: "T-7701"
      }
    });
    expect(actionResult.isError).toBeUndefined();
    expect(JSON.stringify(actionResult.structuredContent)).toContain('"capability":"generateDigest"');
    expect(JSON.stringify(actionResult.structuredContent)).toContain('"routeKey":"ticketList"');

    const actionTaskResult = await mcpModule.callAgentSurfaceMcpTool(
      "capstan_start_task_action",
      {
        routeKey: "ticketList",
        actionKey: "generateDigest",
        input: {
          ticketId: "T-7702"
        }
      }
    );
    expect(actionTaskResult.isError).toBeUndefined();
    expect(JSON.stringify(actionTaskResult.structuredContent)).toContain('"taskKey":"generateDigestTask"');
    expect(JSON.stringify(actionTaskResult.structuredContent)).toContain('"routeKey":"ticketList"');

    const workflowRunResult = await mcpModule.callAgentSurfaceMcpTool("capstan_get_workflow_run", {
      id: (actionTaskResult.structuredContent as { id: string }).id
    });
    expect(workflowRunResult.isError).toBeUndefined();
    expect(JSON.stringify(workflowRunResult.structuredContent)).toContain('"nextAction":"inspect_output"');

    const searchResult = await mcpModule.callAgentSurfaceMcpTool("capstan_search", {
      query: "ticket"
    });
    expect(searchResult.isError).toBeUndefined();
    expect(JSON.stringify(searchResult.structuredContent)).toContain('"resources"');
    expect(JSON.stringify(searchResult.structuredContent)).toContain("generateDigest");
    expect(JSON.stringify(searchResult.structuredContent)).toContain('"queues":[]');

    const taskStartResult = await mcpModule.callAgentSurfaceMcpTool("capstan_start_task", {
      key: "generateDigestTask",
      input: {
        ticketId: "T-7700"
      }
    });
    expect(taskStartResult.isError).toBeUndefined();
    expect(JSON.stringify(taskStartResult.structuredContent)).toContain("digest-mcp-001");

    const approvalTaskStartResult = await mcpModule.callAgentSurfaceMcpTool("capstan_start_task", {
      key: "generateDigestTask",
      input: {
        ticketId: "T-7703",
        mode: "needs_approval"
      }
    });
    expect(approvalTaskStartResult.isError).toBeUndefined();
    expect(JSON.stringify(approvalTaskStartResult.structuredContent)).toContain('"status":"approval_required"');

    const attentionInboxResult = await mcpModule.callAgentSurfaceMcpTool(
      "capstan_list_attention_items",
      {
        taskKey: "generateDigestTask"
      }
    );
    expect(attentionInboxResult.isError).toBeUndefined();
    expect(JSON.stringify(attentionInboxResult.structuredContent)).toContain('"kind":"workflow_run"');
    expect(JSON.stringify(attentionInboxResult.structuredContent)).toContain('"status":"approval_required"');

    const attentionQueueResult = await mcpModule.callAgentSurfaceMcpTool(
      "capstan_list_attention_queues",
      {
        taskKey: "generateDigestTask"
      }
    );
    expect(attentionQueueResult.isError).toBeUndefined();
    expect(JSON.stringify(attentionQueueResult.structuredContent)).toContain('"status":"approval_required"');
    expect(JSON.stringify(attentionQueueResult.structuredContent)).toContain('"openCount":1');

    const approvalWorkflowResult = await mcpModule.callAgentSurfaceMcpTool(
      "capstan_get_workflow_run",
      {
        id: (approvalTaskStartResult.structuredContent as { id: string }).id
      }
    );
    expect(approvalWorkflowResult.isError).toBeUndefined();
    expect(JSON.stringify(approvalWorkflowResult.structuredContent)).toContain('"nextAction":"await_approval"');

    const workflowRunsResult = await mcpModule.callAgentSurfaceMcpTool(
      "capstan_list_workflow_runs",
      {
        taskKey: "generateDigestTask",
        attentionOnly: true
      }
    );
    expect(workflowRunsResult.isError).toBeUndefined();
    expect(JSON.stringify(workflowRunsResult.structuredContent)).toContain('"status":"approval_required"');
    expect(JSON.stringify(workflowRunsResult.structuredContent)).not.toContain('"status":"completed"');

    const approvedWorkflowResult = await mcpModule.callAgentSurfaceMcpTool(
      "capstan_advance_workflow_run",
      {
        id: (approvalTaskStartResult.structuredContent as { id: string }).id,
        action: "approve",
        input: {
          approved: true
        }
      }
    );
    expect(approvedWorkflowResult.isError).toBeUndefined();
    expect(JSON.stringify(approvedWorkflowResult.structuredContent)).toContain('"status":"completed"');

    const taskRunsResult = await mcpModule.callAgentSurfaceMcpTool("capstan_list_task_runs", {
      taskKey: "generateDigestTask"
    });
    expect(taskRunsResult.isError).toBeUndefined();
    const taskRuns = taskRunsResult.structuredContent as Array<{ id: string }>;
    expect(taskRuns).toHaveLength(3);

    const artifactRecordsResult = await mcpModule.callAgentSurfaceMcpTool(
      "capstan_list_artifact_records",
      {
        artifactKey: "ticketDigest"
      }
    );
    expect(artifactRecordsResult.isError).toBeUndefined();
    const records = artifactRecordsResult.structuredContent as Array<{ id: string }>;
    expect(records).toHaveLength(3);

    const getRecordResult = await mcpModule.callAgentSurfaceMcpTool(
      "capstan_get_artifact_record",
      {
        id: records[0]!.id
      }
    );
    expect(getRecordResult.isError).toBeUndefined();
    expect(JSON.stringify(getRecordResult.structuredContent)).toContain("digest-mcp-001");

    const errorResult = await mcpModule.callAgentSurfaceMcpTool("capstan_get_task_run", {
      id: "missing-run"
    });
    expect(errorResult.isError).toBe(true);
    expect(JSON.stringify(errorResult.structuredContent)).toContain("task_run_not_found");
  }, 15_000);
});

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

describe("generated agent surface transport", () => {
  it("handles manifest, query, mutation, and artifact requests through the generated adapter", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-agent-transport-"));
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
        '          reportId: "digest-transport-001",',
        '          ticketId: String(input.ticketId ?? "T-100")',
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
    expect(buildResult.stderr).toBe("");

    const moduleUrl = `${pathToFileURL(join(outputDir, "dist/agent-surface/transport.js")).href}?t=${Date.now()}`;
    const transportModule = (await import(moduleUrl)) as {
      handleAgentSurfaceRequest: (request:
        | { operation: "manifest" }
        | { operation: "resource"; key: string }
        | { operation: "search"; query?: string }
        | {
            operation: "listAttentionItems";
            taskKey?: string;
            resourceKey?: string;
            status?: string;
            routeKey?: string;
            actionKey?: string;
          }
        | {
            operation: "listAttentionQueues";
            taskKey?: string;
            resourceKey?: string;
            routeKey?: string;
            actionKey?: string;
          }
        | {
            operation: "executeAction";
            routeKey: string;
            actionKey: string;
            input?: Record<string, unknown>;
            context?: Record<string, unknown>;
          }
        | {
            operation: "startTaskAction";
            routeKey: string;
            actionKey: string;
            input?: Record<string, unknown>;
            context?: Record<string, unknown>;
          }
        | { operation: "startTask"; key: string; input?: Record<string, unknown> }
        | { operation: "getWorkflowRun"; id: string }
        | {
            operation: "advanceWorkflowRun";
            id: string;
            action: "approve" | "provideInput" | "retry" | "cancel";
            input?: Record<string, unknown>;
            note?: string;
          }
        | {
            operation: "listWorkflowRuns";
            taskKey?: string;
            routeKey?: string;
            actionKey?: string;
            status?: string;
            attentionOnly?: boolean;
          }
        | { operation: "artifact"; key: string }
        | { operation: "listArtifactRecords"; artifactKey?: string }
        | { operation: "getArtifactRecord"; id: string }
        | { operation: "task"; key: string }) => Promise<{
          ok: boolean;
          status: number;
          body?: unknown;
          error?: string;
        }>;
    };

    const manifestResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "manifest"
    });
    expect(manifestResponse.ok).toBe(true);
    expect(manifestResponse.status).toBe(200);
    expect(JSON.stringify(manifestResponse.body)).toContain("transport");
    expect(JSON.stringify(manifestResponse.body)).toContain("hook_optional");
    expect(JSON.stringify(manifestResponse.body)).toContain("approval_required");
    expect(JSON.stringify(manifestResponse.body)).toContain("startTask");
    expect(JSON.stringify(manifestResponse.body)).toContain('"resources"');

    const searchResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "search",
      query: "ticket"
    });
    expect(searchResponse.ok).toBe(true);
    expect(JSON.stringify(searchResponse.body)).toContain('"resources"');
    expect(JSON.stringify(searchResponse.body)).toContain("generateDigest");
    expect(JSON.stringify(searchResponse.body)).toContain("ticket");
    expect(JSON.stringify(searchResponse.body)).toContain('"workflowAttention"');
    expect(JSON.stringify(searchResponse.body)).toContain('"queues":[]');

    const resourceResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "resource",
      key: "ticket"
    });
    expect(resourceResponse.ok).toBe(true);
    expect(JSON.stringify(resourceResponse.body)).toContain('"resource":{"key":"ticket"');
    expect(JSON.stringify(resourceResponse.body)).toContain('"routes"');
    expect(JSON.stringify(resourceResponse.body)).toContain('"actions"');
    expect(JSON.stringify(resourceResponse.body)).toContain('"execution"');
    expect(JSON.stringify(resourceResponse.body)).toContain('"taskStart"');
    expect(JSON.stringify(resourceResponse.body)).toContain('"workflow"');
    expect(JSON.stringify(resourceResponse.body)).toContain('"starter_run_recipe"');
    expect(JSON.stringify(resourceResponse.body)).toContain('"workflowAttention"');

    const actionResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "executeAction",
      routeKey: "ticketList",
      actionKey: "generateDigest",
      input: {
        ticketId: "T-5501"
      }
    });
    expect(actionResponse.ok).toBe(true);
    expect(JSON.stringify(actionResponse.body)).toContain('"capability":"generateDigest"');
    expect(JSON.stringify(actionResponse.body)).toContain('"routeKey":"ticketList"');

    const actionTaskResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "startTaskAction",
      routeKey: "ticketList",
      actionKey: "generateDigest",
      input: {
        ticketId: "T-5502"
      }
    });
    expect(actionTaskResponse.ok).toBe(true);
    expect(actionTaskResponse.status).toBe(202);
    expect(JSON.stringify(actionTaskResponse.body)).toContain('"taskKey":"generateDigestTask"');
    expect(JSON.stringify(actionTaskResponse.body)).toContain('"routeKey":"ticketList"');

    const actionWorkflowResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "getWorkflowRun",
      id: (actionTaskResponse.body as { id: string }).id
    });
    expect(actionWorkflowResponse.ok).toBe(true);
    expect(JSON.stringify(actionWorkflowResponse.body)).toContain('"nextAction":"inspect_output"');

    const startTaskResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "startTask",
      key: "generateDigestTask",
      input: {
        ticketId: "T-5500"
      }
    });
    expect(startTaskResponse.ok).toBe(true);
    expect(startTaskResponse.status).toBe(202);
    expect(JSON.stringify(startTaskResponse.body)).toContain("digest-transport-001");

    const approvalRunResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "startTask",
      key: "generateDigestTask",
      input: {
        ticketId: "T-5510",
        mode: "needs_approval"
      }
    });
    expect(approvalRunResponse.ok).toBe(true);
    expect(JSON.stringify(approvalRunResponse.body)).toContain('"status":"approval_required"');

    const attentionSearchResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "search",
      query: "digest"
    });
    expect(attentionSearchResponse.ok).toBe(true);
    expect(JSON.stringify(attentionSearchResponse.body)).toContain('"workflowAttention"');
    expect(JSON.stringify(attentionSearchResponse.body)).toContain('"approval_required":1');

    const attentionInboxResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "listAttentionItems",
      taskKey: "generateDigestTask"
    });
    expect(attentionInboxResponse.ok).toBe(true);
    expect(JSON.stringify(attentionInboxResponse.body)).toContain('"kind":"workflow_run"');
    expect(JSON.stringify(attentionInboxResponse.body)).toContain('"status":"approval_required"');

    const attentionQueueResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "listAttentionQueues",
      taskKey: "generateDigestTask"
    });
    expect(attentionQueueResponse.ok).toBe(true);
    expect(JSON.stringify(attentionQueueResponse.body)).toContain('"status":"approval_required"');
    expect(JSON.stringify(attentionQueueResponse.body)).toContain('"openCount":1');

    const approvalWorkflowResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "getWorkflowRun",
      id: (approvalRunResponse.body as { id: string }).id
    });
    expect(approvalWorkflowResponse.ok).toBe(true);
    expect(JSON.stringify(approvalWorkflowResponse.body)).toContain('"nextAction":"await_approval"');

    const workflowListResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "listWorkflowRuns",
      taskKey: "generateDigestTask",
      attentionOnly: true
    });
    expect(workflowListResponse.ok).toBe(true);
    expect(JSON.stringify(workflowListResponse.body)).toContain('"status":"approval_required"');
    expect(JSON.stringify(workflowListResponse.body)).not.toContain('"status":"completed"');

    const attentionTaskResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "task",
      key: "generateDigestTask"
    });
    expect(attentionTaskResponse.ok).toBe(true);
    expect(JSON.stringify(attentionTaskResponse.body)).toContain('"workflowAttention"');
    expect(JSON.stringify(attentionTaskResponse.body)).toContain('"openCount":1');
    expect(JSON.stringify(attentionTaskResponse.body)).toContain('"approval_required":1');
    expect(JSON.stringify(attentionTaskResponse.body)).toContain('"queues"');

    const approvedWorkflowResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "advanceWorkflowRun",
      id: (approvalRunResponse.body as { id: string }).id,
      action: "approve",
      input: {
        approved: true
      }
    });
    expect(approvedWorkflowResponse.ok).toBe(true);
    expect(JSON.stringify(approvedWorkflowResponse.body)).toContain('"status":"completed"');

    const taskResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "task",
      key: "generateDigestTask"
    });
    expect(taskResponse.ok).toBe(true);
    expect(JSON.stringify(taskResponse.body)).toContain("\"status\":\"completed\"");

    const artifactResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "artifact",
      key: "ticketDigest"
    });
    expect(artifactResponse.ok).toBe(true);
    expect(JSON.stringify(artifactResponse.body)).toContain("latestRecord");

    const listRecordsResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "listArtifactRecords",
      artifactKey: "ticketDigest"
    });
    expect(listRecordsResponse.ok).toBe(true);
    expect(JSON.stringify(listRecordsResponse.body)).toContain("T-5500");

    const records = listRecordsResponse.body as Array<{ id: string }>;
    const getRecordResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "getArtifactRecord",
      id: records[0]!.id
    });
    expect(getRecordResponse.ok).toBe(true);
    expect(JSON.stringify(getRecordResponse.body)).toContain("digest-transport-001");

    const missingRunResponse = await transportModule.handleAgentSurfaceRequest({
      operation: "getTaskRun",
      id: "missing-task-run"
    } as { operation: "getTaskRun"; id: string });
    expect(missingRunResponse.ok).toBe(false);
    expect(missingRunResponse.status).toBe(404);
    expect((missingRunResponse as { error?: string; code?: string }).code).toBe(
      "task_run_not_found"
    );
  }, 15_000);
});

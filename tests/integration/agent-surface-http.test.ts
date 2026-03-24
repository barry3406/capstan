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

describe("generated agent surface http transport", () => {
  it("projects the generated agent surface through an HTTP/RPC adapter", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "capstan-agent-http-"));
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
        '          reportId: "digest-http-001",',
        '          ticketId: String(input.ticketId ?? "T-HTTP")',
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

    const moduleUrl = `${pathToFileURL(join(outputDir, "dist/agent-surface/http.js")).href}?t=${Date.now()}`;
    const httpModule = (await import(moduleUrl)) as {
      handleAgentSurfaceHttpRequest: (request: {
        method: string;
        path: string;
        query?: Record<string, string>;
        body?: unknown;
      }) => Promise<{
        status: number;
        headers: Record<string, string>;
        body: string;
      }>;
    };

    const manifestResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/manifest"
    });
    expect(manifestResponse.status).toBe(200);
    expect(manifestResponse.headers["content-type"]).toContain("application/json");
    expect(manifestResponse.headers["x-capstan-operation"]).toBe("manifest");
    expect(manifestResponse.body).toContain('"transport"');
    expect(manifestResponse.body).toContain('"http_rpc"');
    expect(manifestResponse.body).toContain('"resources"');

    const searchResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/search",
      query: {
        q: "ticket"
      }
    });
    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body).toContain('"resources"');
    expect(searchResponse.body).toContain("generateDigest");
    expect(searchResponse.body).toContain('"workflowAttention"');
    expect(searchResponse.body).toContain('"queues": []');

    const resourceResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/resources/ticket"
    });
    expect(resourceResponse.status).toBe(200);
    expect(resourceResponse.headers["x-capstan-operation"]).toBe("resource");
    expect(resourceResponse.body).toContain('"resource"');
    expect(resourceResponse.body).toContain('"routes"');
    expect(resourceResponse.body).toContain('"actions"');
    expect(resourceResponse.body).toContain('"execution"');
    expect(resourceResponse.body).toContain('"taskStart"');
    expect(resourceResponse.body).toContain('"workflow"');
    expect(resourceResponse.body).toContain('"starter_run_recipe"');
    expect(resourceResponse.body).toContain('"workflowAttention"');

    const actionResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "POST",
      path: "/routes/ticketList/actions/generateDigest/execute",
      body: {
        input: {
          ticketId: "T-8801"
        }
      }
    });
    expect(actionResponse.status).toBe(200);
    expect(actionResponse.headers["x-capstan-operation"]).toBe("executeAction");
    expect(actionResponse.body).toContain('"capability": "generateDigest"');
    expect(actionResponse.body).toContain('"routeKey": "ticketList"');

    const actionTaskResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "POST",
      path: "/routes/ticketList/actions/generateDigest/start",
      body: {
        input: {
          ticketId: "T-8802"
        }
      }
    });
    expect(actionTaskResponse.status).toBe(202);
    expect(actionTaskResponse.headers["x-capstan-operation"]).toBe("startTaskAction");
    expect(actionTaskResponse.body).toContain('"taskKey": "generateDigestTask"');
    expect(actionTaskResponse.body).toContain('"routeKey": "ticketList"');

    const workflowRunResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: `/workflow-runs/${(JSON.parse(actionTaskResponse.body) as { id: string }).id}`
    });
    expect(workflowRunResponse.status).toBe(200);
    expect(workflowRunResponse.headers["x-capstan-operation"]).toBe("getWorkflowRun");
    expect(workflowRunResponse.body).toContain('"nextAction": "inspect_output"');

    const startTaskResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "POST",
      path: "/tasks/generateDigestTask/start",
      body: {
        ticketId: "T-8800"
      }
    });
    expect(startTaskResponse.status).toBe(202);
    expect(startTaskResponse.headers["x-capstan-operation"]).toBe("startTask");
    expect(startTaskResponse.body).toContain("digest-http-001");

    const approvalRunResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "POST",
      path: "/tasks/generateDigestTask/start",
      body: {
        ticketId: "T-8803",
        mode: "needs_approval"
      }
    });
    expect(approvalRunResponse.status).toBe(202);
    expect(approvalRunResponse.body).toContain('"status": "approval_required"');

    const attentionSearchResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/search",
      query: {
        query: "digest"
      }
    });
    expect(attentionSearchResponse.status).toBe(200);
    expect(attentionSearchResponse.body).toContain('"workflowAttention"');
    expect(attentionSearchResponse.body).toContain('"approval_required": 1');

    const attentionInboxResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/attention-items",
      query: {
        taskKey: "generateDigestTask"
      }
    });
    expect(attentionInboxResponse.status).toBe(200);
    expect(attentionInboxResponse.headers["x-capstan-operation"]).toBe("listAttentionItems");
    expect(attentionInboxResponse.body).toContain('"kind": "workflow_run"');
    expect(attentionInboxResponse.body).toContain('"status": "approval_required"');

    const attentionQueueResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/attention-queues",
      query: {
        taskKey: "generateDigestTask"
      }
    });
    expect(attentionQueueResponse.status).toBe(200);
    expect(attentionQueueResponse.headers["x-capstan-operation"]).toBe("listAttentionQueues");
    expect(attentionQueueResponse.body).toContain('"status": "approval_required"');
    expect(attentionQueueResponse.body).toContain('"openCount": 1');

    const approvalRunId = (JSON.parse(approvalRunResponse.body) as { id: string }).id;
    const approvalWorkflowResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: `/workflow-runs/${approvalRunId}`
    });
    expect(approvalWorkflowResponse.status).toBe(200);
    expect(approvalWorkflowResponse.body).toContain('"nextAction": "await_approval"');

    const workflowListResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/workflow-runs",
      query: {
        taskKey: "generateDigestTask",
        attentionOnly: "true"
      }
    });
    expect(workflowListResponse.status).toBe(200);
    expect(workflowListResponse.headers["x-capstan-operation"]).toBe("listWorkflowRuns");
    expect(workflowListResponse.body).toContain('"status": "approval_required"');
    expect(workflowListResponse.body).not.toContain('"status": "completed"');

    const attentionTaskResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/tasks/generateDigestTask"
    });
    expect(attentionTaskResponse.status).toBe(200);
    expect(attentionTaskResponse.headers["x-capstan-operation"]).toBe("task");
    expect(attentionTaskResponse.body).toContain('"workflowAttention"');
    expect(attentionTaskResponse.body).toContain('"openCount": 1');
    expect(attentionTaskResponse.body).toContain('"approval_required": 1');
    expect(attentionTaskResponse.body).toContain('"queues"');

    const approvedWorkflowResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "POST",
      path: `/workflow-runs/${approvalRunId}/actions/approve`,
      body: {
        input: {
          approved: true
        }
      }
    });
    expect(approvedWorkflowResponse.status).toBe(200);
    expect(approvedWorkflowResponse.headers["x-capstan-operation"]).toBe("advanceWorkflowRun");
    expect(approvedWorkflowResponse.body).toContain('"status": "completed"');

    const listRunsResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/task-runs",
      query: {
        taskKey: "generateDigestTask"
      }
    });
    expect(listRunsResponse.status).toBe(200);
    const runs = JSON.parse(listRunsResponse.body) as Array<{ id: string }>;
    expect(runs).toHaveLength(3);

    const rpcResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "POST",
      path: "/rpc",
      body: {
        operation: "getTaskRun",
        id: runs[0]!.id
      }
    });
    expect(rpcResponse.status).toBe(200);
    expect(rpcResponse.headers["x-capstan-operation"]).toBe("getTaskRun");
    expect(rpcResponse.body).toContain('"status": "completed"');

    const artifactResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/artifacts/ticketDigest"
    });
    expect(artifactResponse.status).toBe(200);
    expect(artifactResponse.body).toContain("latestRecord");

    const notFoundResponse = await httpModule.handleAgentSurfaceHttpRequest({
      method: "GET",
      path: "/missing-route"
    });
    expect(notFoundResponse.status).toBe(404);
    expect(notFoundResponse.body).toContain("http_route_not_found");
  }, 15_000);
});
